import { Stack } from "expo-router";
import { MqttProvider } from "./context/MqttContext";

export default function RootLayout() {
  return (
    <MqttProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </MqttProvider>
  );
}
