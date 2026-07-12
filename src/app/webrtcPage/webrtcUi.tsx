import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import { useMqtt } from '../context/MqttContext';

export default function WebRtcControlScreen() {
    useEffect(() => {
        // Lock to landscape when page loads
        async function lockOrientation() {
            await ScreenOrientation.lockAsync(
                ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
            );
        }

        lockOrientation();

        // Revert back to portrait when leaving the page
        return () => {
            ScreenOrientation.lockAsync(
                ScreenOrientation.OrientationLock.PORTRAIT_UP
            );
        };
    }, []);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    useEffect(() => {
        // Write your startup logic here
        start();

    }, []); // Empty array ensures this only runs once
    // Note: telemetry and isConnected are ready here to bind to your UI or robot controls
    useEffect(() => {
        const backAction = () => {
            // Handle the back button press here
            console.log('Back button pressed. You can handle navigation or cleanup here.');
            if (peerConnectionRef.current != null) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
            return false; // Prevent default behavior (exit app)
        };

        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            backAction
        );

        return () => backHandler.remove(); // Cleanup on unmount
    }, []);
    const { publishMessage, isConnected, waitForAnswer } = useMqtt();
    const [localStream, setLocalStream] = useState(null);

    const sendOffer = (offerDescription: JSON) => {
        // Send the offerDescription to the other participant via your signaling server or MQTT
        var messageToSend = {
            "command_type": 3,
            "content": offerDescription
        };
        publishMessage("control", JSON.stringify(messageToSend));
    }

    const [remoteMediaStream, setRemoteMediaStream] = useState(null); // This will hold the remote stream when received
    const [connectionStatus, setConnectionStatus] = useState<string>('Initializing...');
    const start = async () => {
        if (!localStream) {
            try {
                const s = await mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: 'user' }
                });
                setLocalStream(s);

                const peerConstraints = {
                    iceServers: [
                        // Public Google STUN servers
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' },
                        // Free public TURN servers for carrier-grade NAT (mobile data)
                        // OpenRelay - free public TURN
                        {
                            urls: 'turn:openrelay.metered.ca:80?transport=tcp',
                            username: 'openrelayproject',
                            credential: 'openrelayproject',
                        },
                        {
                            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                            username: 'openrelayproject',
                            credential: 'openrelayproject',
                        },
                        // FreeTURN - another free public TURN service
                        {
                            urls: 'turn:freeturn.net:3478',
                            username: 'free',
                            credential: 'free',
                        },
                        // Public TURN from turn.geforcenow.com (NVIDIA)
                        {
                            urls: 'turn:turn.geforcenow.com:3478',
                            username: 'nvidia',
                            credential: 'nvidia',
                        },
                    ],
                    iceTransportPolicy: 'all' as const, // Use both host and relay candidates
                };
                peerConnectionRef.current = new RTCPeerConnection(peerConstraints);

                // --- REMOVE THE 'icecandidate' MQTT PUBLISH BLOCK ENTIRELY ---
                // You don't need to send candidates via MQTT one-by-one anymore.
                peerConnectionRef.current.addEventListener('icecandidate', event => {
                    if (!event.candidate) return;
                    console.log('Gathered candidate locally:', event.candidate);
                });

                peerConnectionRef.current.addEventListener('iceconnectionstatechange', () => {
                    const state = peerConnectionRef.current?.iceConnectionState;
                    console.log('ICE connection state:', state);
                    switch (state) {
                        case 'checking':
                            setConnectionStatus('Connecting...');
                            break;
                        case 'connected':
                        case 'completed':
                            setConnectionStatus('');
                            break;
                        case 'disconnected':
                            setConnectionStatus('Disconnected');
                            break;
                        case 'failed':
                            setConnectionStatus('Connection failed');
                            console.error('ICE connection failed — check STUN/TURN server availability');
                            break;
                        case 'closed':
                            setConnectionStatus('Connection closed');
                            break;
                    }
                });

                peerConnectionRef.current.addEventListener('track', event => {
                    setRemoteMediaStream(prevStream => {
                        const newStream = prevStream || new MediaStream();
                        newStream.addTrack(event.track, newStream);
                        return newStream;
                    });
                });

                s.getTracks().forEach(track => {
                    peerConnectionRef.current.addTrack(track, s);
                });

                let sessionConstraints = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                    voiceActivityDetection: true
                };

                // Create Offer locally
                const offerDescription = await peerConnectionRef.current.createOffer(sessionConstraints);
                await peerConnectionRef.current.setLocalDescription(offerDescription);

                setConnectionStatus('Gathering ICE candidates...');
                // --- WAIT FOR GATHERING TO COMPLETE BEFORE SENDING TO MQTT ---
                // Timeout after 15s so we don't hang forever if STUN/TURN servers are unreachable.
                console.log("Gathering ICE candidates locally...");
                await new Promise<void>((resolve) => {
                    const gatherTimeout = setTimeout(() => {
                        peerConnectionRef.current?.removeEventListener('icegatheringstatechange', checkState);
                        console.warn('ICE gathering timed out after 15s — sending partial candidates');
                        resolve();
                    }, 15000);

                    const checkState = () => {
                        if (peerConnectionRef.current?.iceGatheringState === 'complete') {
                            clearTimeout(gatherTimeout);
                            peerConnectionRef.current?.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };
                    if (peerConnectionRef.current?.iceGatheringState === 'complete') {
                        clearTimeout(gatherTimeout);
                        resolve();
                    } else {
                        peerConnectionRef.current?.addEventListener('icegatheringstatechange', checkState);
                    }
                });

                // Now localDescription has all STUN/TURN candidates baked directly inside it
                console.log("Gathering complete! Sending full SDP Offer via MQTT...");
                setConnectionStatus('Sending offer...');
                sendOffer(peerConnectionRef.current.localDescription);

                try {
                    setConnectionStatus('Waiting for answer...');
                    const answer = await waitForAnswer(60000);
                    await peerConnectionRef.current.setRemoteDescription(
                        new RTCSessionDescription(answer)
                    );
                    console.log('Remote description set successfully');
                    setConnectionStatus('Establishing connection...');
                } catch (err) {
                    console.error('Failed to receive WebRTC answer:', err);
                    setConnectionStatus('Failed to get answer');
                }

            } catch (e) {
                console.error("Failed to acquire camera stream:", e);
            }
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            {remoteMediaStream && (
                <View style={styles.videoContainer}>
                    <RTCView
                        streamURL={remoteMediaStream.toURL()}
                        style={styles.remoteView}
                        objectFit="cover"
                    />
                </View>
            )}
            {connectionStatus !== '' && (
                <View style={styles.statusOverlay}>
                    <View style={styles.statusPopup}>
                        <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
                        <Text style={styles.statusText}>{connectionStatus}</Text>
                    </View>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#231d42', // Matching your modal theme color
    },
    videoContainer: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000',
    },
    remoteView: {
        width: '100%',
        height: '100%',
    },
    buttonContainer: {
        padding: 20,
        backgroundColor: '#231d42',
    },
    statusOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    statusPopup: {
        backgroundColor: '#231d42',
        borderRadius: 12,
        paddingVertical: 20,
        paddingHorizontal: 30,
        alignItems: 'center',
        minWidth: 200,
    },
    spinner: {
        marginBottom: 12,
    },
    statusText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
    },
});
