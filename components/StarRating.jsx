// Tap-to-rate stars with a one-line thank you once saved.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE, SPACE } from './ui/kit';
import { submitRating } from '../utils/ratings';

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

export default function StarRating({ rideId, who, existing, prompt, style }) {
  const [stars, setStars] = useState(existing?.stars || 0);
  const [saved, setSaved] = useState(Boolean(existing?.stars));
  const [error, setError] = useState(null);

  const rate = async (n) => {
    if (saved) return;
    setStars(n);
    try {
      await submitRating(rideId, who, n);
      setSaved(true);
      setError(null);
    } catch (e) {
      console.log('Rating save failed:', e);
      setError('Could not save your rating. Tap a star to try again.');
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <Text style={TYPE.heading}>{saved ? 'Thanks for rating' : prompt}</Text>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => rate(n)}
            disabled={saved}
            activeOpacity={0.7}
            style={styles.star}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            accessibilityState={{ selected: n <= stars, disabled: saved }}
          >
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={36} color={n <= stars ? COLORS.star : COLORS.lineStrong} />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[TYPE.small, stars && !error ? { color: COLORS.midnight, fontWeight: '700' } : null, error && { color: COLORS.red }]}>
        {error || (stars ? WORDS[stars] : 'Tap a star')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: SPACE[2] },
  row: { flexDirection: 'row', gap: SPACE[1], marginVertical: SPACE[2] },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
