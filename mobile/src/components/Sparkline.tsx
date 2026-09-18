import React from 'react';
import { View } from 'react-native';

export function Sparkline({ values = [] }: { values?: number[] }) {
  if (values.length < 2) return <View style={{ width: 96, height: 30 }} />;
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(0.01, max - min);
  return (
    <View style={{ width: 96, height: 34, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {values.map((v, i) => {
        const h = 6 + ((v - min) / range) * 25;
        const prev = i === 0 ? v : values[i - 1];
        return <View key={i} style={{ width: 6, height: h, borderRadius: 2, backgroundColor: v >= prev ? '#35D99A' : '#FF5B67' }} />;
      })}
    </View>
  );
}
