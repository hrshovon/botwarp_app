import { Pressable, StyleSheet, Text } from 'react-native';

const RoundButton = ({ onPress, title = '+' }) => {
  return (
    <Pressable 
      onPress={onPress} 
      style={({ pressed }) => [
        styles.button,
        { opacity: pressed ? 0.7 : 1.0 } // Visual feedback when tapped
      ]}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 250,
    height: 250,
    borderRadius: 125, // Half of width/height makes it a perfect circle
    backgroundColor: '#007AFF',
    justifyContent: 'center', // Centers text vertically
    alignItems: 'center',     // Centers text horizontally
    
    // Optional: Add a shadow for depth
    elevation: 3, // For Android
    shadowColor: '#000', // For iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
});

export default RoundButton;