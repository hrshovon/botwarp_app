import mqtt, { MqttClient } from 'mqtt';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

// 1. Structure your incoming data states
interface DeviceStatus {
    online: boolean;
    battery: number;
}

interface webrtcAnswer {
    type: string;
    sdp: string;
}


interface QueuedMessage {
    topic: string;
    message: string;
    retries: number;
}

interface MqttContextType {
    deviceStatus: DeviceStatus;
    webrtcAnswer: webrtcAnswer | null;
    isConnected: boolean;
    waitForAnswer: (timeoutMs?: number) => Promise<webrtcAnswer>;
    publishMessage: (topic: string, message: string) => Promise<boolean>;
}

const MqttContext = createContext<MqttContextType | undefined>(undefined);

interface MqttProviderProps {
    children: React.ReactNode;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export function MqttProvider({ children }: MqttProviderProps) {
    // ... rest of your state and useEffect hook logic
    const [isConnected, setIsConnected] = useState(false);
    const [webrtcAnswer, setWebrtcAnswer] = useState<webrtcAnswer | null>(null);
    const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({ online: false, battery: 0 });

    const clientRef = useRef<MqttClient | null>(null);
    const answerResolverRef = useRef<((answer: webrtcAnswer) => void) | null>(null);
    const messageQueueRef = useRef<QueuedMessage[]>([]);
    const isPublishingRef = useRef(false);
    const waitForAnswer = (timeoutMs = 10000): Promise<webrtcAnswer> => {
        return new Promise<webrtcAnswer>((resolve, reject) => {
            // Set up timeout
            const timer = setTimeout(() => {
                answerResolverRef.current = null;
                reject(new Error('WebRTC answer timed out'));
            }, timeoutMs);

            // Store resolver — will be called when message arrives
            answerResolverRef.current = (answer) => {
                clearTimeout(timer);
                answerResolverRef.current = null;
                resolve(answer);
            };
        });
    };
    // Process queued messages when connection is established
    const processQueue = async () => {
        if (isPublishingRef.current || messageQueueRef.current.length === 0) return;
        
        isPublishingRef.current = true;
        const client = clientRef.current;
        
        while (messageQueueRef.current.length > 0 && client?.connected) {
            const queuedMsg = messageQueueRef.current[0];
            try {
                await new Promise<void>((resolve, reject) => {
                    client!.publish(queuedMsg.topic, queuedMsg.message, { qos: 1 }, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`Queued message published successfully to ${queuedMsg.topic}`);
                messageQueueRef.current.shift();
            } catch (err) {
                console.warn(`Failed to publish queued message to ${queuedMsg.topic}:`, err);
                queuedMsg.retries++;
                if (queuedMsg.retries >= MAX_RETRIES) {
                    console.error(`Message dropped after ${MAX_RETRIES} retries`);
                    messageQueueRef.current.shift();
                }
                break;
            }
        }
        
        isPublishingRef.current = false;
    };

    useEffect(() => {
        console.log('Initializing MQTT connection...');
        // Connect via WebSockets for Expo compatibility (use 'ws' or 'wss')
        const mqttClient = mqtt.connect('ws://162.254.35.41:9012/', {
            clientId: `expo_app_${Math.random().toString(16).slice(2, 10)}`,
            clean: true,
            reconnectPeriod: 3000,
            connectTimeout: 10000,
        });
        
        mqttClient.on('error', (err) => {
            console.log('MQTT connection error:', err);
            // Don't call end() - let the client attempt to reconnect
        });

        mqttClient.on('connect', () => {
            console.log('MQTT client connected successfully');
            setIsConnected(true);
            // Subscribe to all relevant topics here
            mqttClient.subscribe(['status', 'webrtc'], { qos: 1 }, (err) => {
                if (!err) {
                    console.log('Successfully subscribed to topics');
                    // Process any queued messages after successful connection
                    processQueue();
                } else {
                    console.warn('Subscription error:', err);
                }
            });
        });

        mqttClient.on('close', () => {
            console.log('MQTT connection closed');
            setIsConnected(false);
        });
        
        mqttClient.on('offline', () => {
            console.log('MQTT client is offline');
            setIsConnected(false);
        });
        
        mqttClient.on('reconnect', () => {
            console.log('MQTT client attempting to reconnect...');
        });

        // 2. The Centralized Callback: Route incoming messages to appropriate variables
        mqttClient.on('message', (topic, message) => {
            console.log(`Received message on topic ${topic}: ${message.toString()}`);
            try {
                const payloadString = message.toString();
                const jsonPayload = JSON.parse(payloadString);

                // Routing engine based on topic matching
                switch (topic) {

                    case 'status':
                        setDeviceStatus({
                            online: jsonPayload.status === 'online',
                            battery: jsonPayload.bat ?? 0,
                        });
                        break;
                    case 'webrtc':
                        const rcv_answer: webrtcAnswer = {
                            type: jsonPayload.type,
                            sdp: jsonPayload.sdp,
                        };
                        setWebrtcAnswer(rcv_answer);
                        if (answerResolverRef.current) {
                            answerResolverRef.current(rcv_answer);
                        }
                        break;
                    default:
                        console.log(`Unhandled topic stream: ${topic}`);
                }
            } catch (error) {
                console.log('Failed to parse incoming MQTT payload', error);
            }
        });

        clientRef.current = mqttClient;
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                console.log('App has come to the foreground! Validating MQTT connection...');

                const client = clientRef.current;
                // If the client exists but lost its connection while suspended, force a reconnect
                if (client && !client.connected) {
                    console.log('MQTT disconnected during sleep. Forcing reconnect now.');
                    client.reconnect();
                }
            }
        };
        const subscription = AppState.addEventListener('change', handleAppStateChange);

        // Cleanup connection when the provider unmounts
        return () => {
            subscription.remove();
            if (clientRef.current) {
                clientRef.current.end();
                console.log('MQTT client disconnected on provider unmount');
            }
        };
    }, []);

    const publishMessage = async (topic: string, message: string): Promise<boolean> => {
        const client = clientRef.current;
        
        // Check actual client connected state, not just React state
        if (!client || !client.connected) {
            console.warn(`MQTT not connected. Queueing message for topic: ${topic}`);
            messageQueueRef.current.push({ topic, message, retries: 0 });
            return false;
        }

        // Attempt to publish with retry logic
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                await new Promise<void>((resolve, reject) => {
                    client.publish(topic, message, { qos: 1 }, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`Message published successfully to ${topic}`);
                return true;
            } catch (err) {
                console.warn(`Publish attempt ${attempt + 1}/${MAX_RETRIES} failed for ${topic}:`, err);
                if (attempt < MAX_RETRIES - 1) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }
            }
        }
        
        // All retries failed - queue the message for later
        console.error(`Failed to publish to ${topic} after ${MAX_RETRIES} attempts. Queueing for retry.`);
        messageQueueRef.current.push({ topic, message, retries: 0 });
        return false;
    };
    return (
        <MqttContext.Provider value={{ deviceStatus, webrtcAnswer, isConnected, waitForAnswer, publishMessage }}>
            {children}
        </MqttContext.Provider>
    );
}

export const useMqtt = () => {
    const context = useContext(MqttContext);
    if (!context) {
        throw new Error('useMqtt must be used within an MqttProvider');
    }
    return context;
};