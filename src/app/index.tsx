import { globalStyles } from '@/styles/global';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Text, View } from "react-native";
import Svg, { Rect } from 'react-native-svg';
import { useMqtt } from './context/MqttContext';
import SendMessagePopup from './popups/SendMessagePopup';
import RoundButton from './roundButton';

export default function HomeScreen() {
  const router = useRouter();
  const batteryLevel = 0.75; // Example battery level (75%)
  const batteryWidth = 60; // Total width of the battery icon
  const { deviceStatus, isConnected } = useMqtt();
  const filledWidth = parseFloat(deviceStatus.battery.toString()) * batteryWidth; // Calculate filled width based on battery level
  const [sendMsgPopupState, setsendMsgPopupState] = useState(false);
  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>WARP TO BOT</Text>
      <View style={[globalStyles.borderedContainer, globalStyles.rowContainer]}>
        <View style={{ ...globalStyles.box, width: '70%' }}>
          <Text style={globalStyles.empty}>Status: {deviceStatus.online ? 'Online' : 'Offline'}</Text>
        </View>
        <View style={{ ...globalStyles.box, width: '20%' }}>
          <Svg height="50" width={batteryWidth}>
            <Rect
              x="0"
              y="15"
              width={batteryWidth}
              height="20"
              fill="white"
            />
            <Rect
              x="0"
              y="15"
              width={filledWidth}
              height="20"
              fill="green"
            />
          </Svg>

        </View>
        <View style={{ ...globalStyles.box, width: '10%' }}>
          <Text style={globalStyles.empty}>{Math.round(parseFloat(deviceStatus.battery.toString()) * 100)}%</Text>
        </View>
      </View>
      <View style={{ ...globalStyles.borderedContainer, height: "60%" }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <RoundButton onPress={() => router.push('/webrtcPage/webrtcUi')} title="WARP" />
        </View>
      </View>
      <View style={{ ...globalStyles.borderedContainer, height: "10%", justifyContent: 'center' }}>
        <Button
          title="Text Message"
          color="#1e90ff"
          onPress={() => setsendMsgPopupState(true)}
        />
        <SendMessagePopup
          show={sendMsgPopupState}
          onClose={() => setsendMsgPopupState(false)}
        />
      </View>

    </View>
  );
}