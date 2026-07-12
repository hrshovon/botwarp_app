import CheckBox from 'expo-checkbox';
import { useState } from 'react';
import { Button, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from 'react-native-modal';
import { useMqtt } from '../context/MqttContext';
interface sendMessagePopupProps {
  show: boolean;
  onClose: () => void;
}

export default function SendMessagePopup({ show, onClose }: sendMessagePopupProps) {
  const { publishMessage, isConnected } = useMqtt();
  const [dataToSend, setDataToSend] = useState("");
  const [untilClosed, setUntilClosed] = useState(false);
  const [holdDuration, setHoldDuration] = useState('60');
  enum NotificationType {
    Message = 1,
    CloseMessageBox
  }
  const prepareJsonAndSend = (notificationType: NotificationType) => {
    const payload = { "command_type": 2, "nt_type": notificationType ,"notification": dataToSend , "holdDuration": parseInt(holdDuration), 'untilClosed': untilClosed};
    publishMessage("control", JSON.stringify(payload));
  }

  const handleTextChange = (text: string) => {
    // This regex removes any character that is NOT a digit (0-9)
    var numericText = text.replace(/[^0-9]/g, '');
    if (parseInt(numericText) > 86400) {
      numericText = '60';
    }
    setHoldDuration(numericText);
  };

  return (
    <Modal
      isVisible={show}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      useNativeDriver={true}
      backdropOpacity={0.5}
      style={styles.modalWrapper} // Added this to center the content window properly
    >
      {/* Removed the 'centeredView' wrapper that was blocking the backdrop */}
      <View style={styles.modalView}>
        <Text style={styles.modalText}>Enter message to show on the display.</Text>
        <View style={styles.textAreaContainer}>
          <TextInput
            style={styles.textArea}
            underlineColorAndroid="transparent"
            placeholder="Type your long message here..."
            placeholderTextColor="#999"
            numberOfLines={10}
            multiline={true}
            onChangeText={(value) => setDataToSend(value)}
          />
        </View>
        <View style={styles.secondsContainer}>
          {/* Left Label */}
          <Text style={styles.labelText}>Hold duration</Text>

          {/* Input Block */}
          <View style={styles.secondsInputContainer}>
            <TextInput
              style={styles.secondsInput}
              underlineColorAndroid="transparent"
              placeholder="60"
              value={holdDuration}
              placeholderTextColor="#999"
              keyboardType="numeric"
              editable={!untilClosed}
              onChangeText={handleTextChange}
            />
          </View>

          {/* Checkbox Group Block */}
          <View style={styles.checkboxGroup}>
            <CheckBox
              value={untilClosed}
              onValueChange={setUntilClosed}
              color={untilClosed ? '#48eaff' : undefined} // Optional: Matches your border color
            />
            <Text style={styles.checkboxLabel}>Until Closed</Text>
          </View>
        </View>

        <View style={{flexDirection: 'row', gap: 10}}>
          <Button title="Send Message" onPress={() => prepareJsonAndSend(NotificationType.Message)} />
          <Button title="Collapse Messagebox" onPress={() => prepareJsonAndSend(NotificationType.CloseMessageBox)} />
            
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Use this style on the Modal component itself to center the window
  modalWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    margin: 0, // Prevents default library margins from shrinking your width
  },
  modalView: {
    width: '85%',
    backgroundColor: '#231d42',
    borderRadius: 20,
    padding: 20, // Increased slightly for better text spacing
    alignItems: 'center',
    elevation: 5,
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
    color: '#fff', // Changed to white so it is visible against #231d42 background
  },
  textAreaContainer: {
    borderColor: '#48eaff',
    borderWidth: 2,
    borderRadius: 8,
    padding: 5,
    width: '100%',
    backgroundColor: '#f9f9f9',
    marginBottom: 15, // Added spacing before the button
  },
  textArea: {
    height: 150,
    justifyContent: "flex-start",
    textAlignVertical: 'top',
    fontSize: 16,
    color: '#333',
    padding: 10,
  },
  secondsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between', // Spreads elements nicely across the width
    width: '100%',
    marginBottom: 20, // Clean separation from the Send button
  },
  labelText: {
    color: '#fff',
    fontSize: 14,
  },
  secondsInputContainer: {
    borderColor: '#48eaff',
    borderWidth: 2,
    borderRadius: 8,
    width: '20%',
    backgroundColor: '#f9f9f9',
    height: 40, // Increased slightly to give text a bit more breathing room
    justifyContent: 'center',
  },
  secondsInput: {
    height: '100%',
    width: '100%',
    color: '#333',
    fontSize: 16,
    textAlign: 'center',
    textAlignVertical: 'center', // Centers text perfectly on Android
    ...Platform.select({
      ios: {
        // iOS handles vertical alignment naturally if padding is even
        paddingVertical: 0,
      },
      android: {
        // Android needs explicit padding override to avoid top clipping
        paddingTop: 0,
        paddingBottom: 2,
      },
    }),
    paddingHorizontal: 5,
  },
  checkboxGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxLabel: {
    color: '#fff',
    marginLeft: 6, // Gives space between the checkbox box and its text
    fontSize: 14,
  },
});