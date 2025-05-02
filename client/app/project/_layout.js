import { Tabs } from "expo-router";

export default function ProjectLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="updateFileMeta" options={{
        tabBarStyle : {
          display: 'none',
        }
       }} />
    </Tabs>
  );
}
