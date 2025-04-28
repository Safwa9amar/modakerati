import React from 'react';
import { Tabs } from 'expo-router';

export default function FreelanceMarketplaceLayout() {
  return (
    <Tabs 
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          display: 'none',
        },
        tabBarItemStyle: {
          display: 'none',
        },
      }}
    >
      <Tabs.Screen
        name="StudentRequests"
        options={{ title: 'سوق العمل الحر' }}
      />
      <Tabs.Screen name="index" options={{ title: 'سوق العمل الحر' }} />
      <Tabs.Screen name="RequestDetails" options={{ title: 'تفاصيل الطلب' }} />
      <Tabs.Screen name="SubmitOffer" options={{ title: 'تقديم عرض' }} />
      <Tabs.Screen name="MyOffers" options={{ title: 'عروضي' }} />
      <Tabs.Screen name="Chat" options={{ title: 'الرسائل' }} />
      <Tabs.Screen name="Review" options={{ title: 'التقييم' }} />
    </Tabs>
  );
}
