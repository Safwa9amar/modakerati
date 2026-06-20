import { View, Text } from "react-native";

export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#121220" }}>
      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "bold" }}>Modakerati</Text>
      <Text style={{ color: "#9999AE", fontSize: 16, marginTop: 8 }}>مذكرتي</Text>
    </View>
  );
}
