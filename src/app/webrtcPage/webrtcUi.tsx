import { useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import { useMqtt } from '../context/MqttContext';
import SendMessagePopup from '../popups/SendMessagePopup';

export default function WebRtcControlScreen() {
    const router = useRouter();
    
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
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [sendMsgPopupState, setSendMsgPopupState] = useState(false);
    const [audioOutput, setAudioOutput] = useState<'earpiece' | 'speaker'>('earpiece');

    const cycleAudioOutput = async () => {
        const nextOutput = audioOutput === 'earpiece' ? 'speaker' : 'earpiece';
        
        try {
            // Use InCallManager to control speaker
            if (nextOutput === 'speaker') {
                InCallManager.setForceSpeakerphoneOn(true);
                console.log('InCallManager: Speaker enabled');
            } else {
                InCallManager.setForceSpeakerphoneOn(false);
                console.log('InCallManager: Speaker disabled (earpiece)');
            }
            
            setAudioOutput(nextOutput);
        } catch (e) {
            console.log('Failed to set audio route:', e);
        }
    };

    const getAudioOutputIcon = () => {
        switch (audioOutput) {
            case 'speaker':
                return '🔊';
            case 'earpiece':
            default:
                return '📱';
        }
    };

    const toggleVideo = () => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = !videoEnabled;
            });
            setVideoEnabled(!videoEnabled);
        }
    };

    const toggleAudio = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !audioEnabled;
            });
            setAudioEnabled(!audioEnabled);
        }
    };

    const endCall = () => {
        console.log('Ending call and cleaning up resources...');
        
        // Stop InCallManager
        try {
            InCallManager.stop();
            console.log('InCallManager stopped');
        } catch (e) {
            console.log('InCallManager stop warning:', e);
        }
        
        // Close peer connection
        if (peerConnectionRef.current != null) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
            console.log('Peer connection closed');
        }
        
        // Stop and release local stream tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
                console.log(`Stopped track: ${track.kind}`);
            });
            setLocalStream(null);
            console.log('Local stream released');
        }
        
        // Clear remote stream
        setRemoteMediaStream(null);
        console.log('Remote stream cleared');
        
        // Reset UI state
        setConnectionStatus('');
        setVideoEnabled(true);
        setAudioEnabled(true);
        
        // Navigate back to first screen
        console.log('Navigating back to home screen');
        router.replace('/');
    };

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
                // Configure audio using InCallManager
                try {
                    // Start InCallManager for media type (video call)
                    InCallManager.start({ media: 'video' });
                    // Enable speaker by default
                    InCallManager.setForceSpeakerphoneOn(true);
                    setAudioOutput('speaker');
                    console.log('InCallManager started with speaker enabled');
                } catch (audioErr) {
                    console.log('InCallManager configuration warning:', audioErr);
                }

                // Request audio permission on Android
                if (Platform.OS === 'android') {
                    try {
                        const granted = await PermissionsAndroid.request(
                            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                            {
                                title: 'Microphone Permission',
                                message: 'This app needs access to your microphone for voice communication.',
                                buttonNeutral: 'Ask Me Later',
                                buttonNegative: 'Cancel',
                                buttonPositive: 'OK',
                            }
                        );
                        console.log('Microphone permission:', granted);
                        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                            console.warn('Microphone permission denied');
                        }
                    } catch (err) {
                        console.warn('Error requesting microphone permission:', err);
                    }
                }

                // Audio constraints - explicitly request audio capture
                const audioConstraints = {
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                    } as any,
                    video: { facingMode: 'user' }
                };
                
                console.log('Requesting media with constraints:', JSON.stringify(audioConstraints));
                const s = await mediaDevices.getUserMedia(audioConstraints);
                
                // Log track info for debugging
                s.getTracks().forEach(track => {
                    console.log(`Track: kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
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
        <View style={styles.container}>
            {remoteMediaStream && (
                <View style={styles.videoContainer}>
                    <RTCView
                        streamURL={remoteMediaStream.toURL()}
                        style={styles.remoteView}
                        objectFit="cover"
                    />
                    <View style={styles.buttonOverlay}>
                        <TouchableOpacity
                            style={[styles.controlButton, !videoEnabled && styles.buttonDisabled]}
                            onPress={toggleVideo}
                        >
                            <Text style={styles.buttonIcon}>
                                {videoEnabled ? '📹' : '🚫'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.controlButton, !audioEnabled && styles.buttonDisabled]}
                            onPress={toggleAudio}
                        >
                            <Text style={styles.buttonIcon}>
                                {audioEnabled ? '🎤' : '🔇'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.controlButton, styles.endCallButton]}
                            onPress={endCall}
                        >
                            <Text style={styles.buttonIcon}>📞</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => setSendMsgPopupState(true)}
                        >
                            <Text style={styles.buttonIcon}>💬</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={cycleAudioOutput}
                        >
                            <Text style={styles.buttonIcon}>{getAudioOutputIcon()}</Text>
                        </TouchableOpacity>
                    </View>
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
            <SendMessagePopup
                show={sendMsgPopupState}
                onClose={() => setSendMsgPopupState(false)}
            />
        </View>
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
    buttonOverlay: {
        position: 'absolute',
        top: 20,
        right: 20,
        flexDirection: 'row',
        gap: 10,
    },
    controlButton: {
        width: 48,
        height: 48,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonDisabled: {
        backgroundColor: 'rgba(255, 0, 0, 0.6)',
    },
    endCallButton: {
        backgroundColor: 'rgba(220, 20, 20, 0.8)',
    },
    buttonIcon: {
        fontSize: 20,
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
