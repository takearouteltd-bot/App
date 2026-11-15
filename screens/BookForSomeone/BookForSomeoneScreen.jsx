/* Book a taxi for someone else: who is riding (name, and their mobile so the
   driver can call them and they get a text with a tracking link), where
   they are picked up and where they are going. Stops are added on the fare
   screen, as for any booking. See utils/bookingFor.js. */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../../components/ui/alert';
import { Banner, Button, Chip, COLORS, Field, Footer, RADIUS, Screen, ScreenHeader, SPACE, TYPE } from '../../components/ui/kit';
import { cleanName, NAME_MAX, prettyPhone, recentPeople, rememberPerson, ukPhone } from '../../utils/bookingFor';

export default function BookForSomeoneScreen({ navigation, route }) {
  const prefill = route.params?.prefill || {};
  const [name, setName] = useState(prefill.name || '');
  const [phone, setPhone] = useState(prefill.phone ? prettyPhone(prefill.phone) : '');
  const [pickup, setPickup] = useState(prefill.origin || null);
  const [destination, setDestination] = useState(prefill.destination || null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    recentPeople().then(setRecent);
  }, []);

  // A place chosen on the search screen comes back here.
  useEffect(() => {
    const picked = route.params?.picked;
    if (!picked?.place) return;
    if (picked.target === 'pickup') setPickup(picked.place);
    else setDestination(picked.place);
    navigation.setParams({ picked: undefined });
  }, [route.params?.picked, navigation]);

  const choose = (target) =>
    navigation.push('DestinationSearch', {
      mode: 'pick',
      target,
      origin: pickup || destination || prefill.origin || null,
      who: cleanName(name),
    });

  const phoneTyped = phone.trim().length > 0;
  const phoneOk = !phoneTyped || Boolean(ukPhone(phone));

  const seePrices = async () => {
    const who = cleanName(name);
    if (!who) {
      Alert.alert('Who is riding?', 'Add the name of the person you are booking for, so the driver knows who to look for.');
      return;
    }
    if (!phoneOk) {
      Alert.alert('Check their mobile', 'Enter a UK mobile number, like 07123 456789, or leave it empty.');
      return;
    }
    if (!pickup) {
      Alert.alert('Add the pickup', `Where should the driver collect ${who}?`);
      return;
    }
    if (!destination) {
      Alert.alert('Add the destination', `Where is ${who} going?`);
      return;
    }
    const person = { name: who, phone: ukPhone(phone) || '' };
    rememberPerson(person);
    navigation.navigate('FareEstimation', {
      origin: { ...pickup, address: pickup.address || pickup.description },
      destination,
      stops: Array.isArray(prefill.stops) ? prefill.stops : [],
      passengerFor: person,
    });
  };

  const place = (label, value, target, icon) => (
    <TouchableOpacity
      style={styles.place}
      onPress={() => choose(target)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value.description || value.address}. Change` : `Choose ${label.toLowerCase()}`}
    >
      <Ionicons name={icon} size={18} color={COLORS.midnight} />
      <View style={{ flex: 1 }}>
        <Text style={TYPE.label}>{label}</Text>
        <Text style={[styles.placeText, !value && { color: COLORS.faint }]} numberOfLines={2}>
          {value ? value.description || value.address : 'Search an address'}
        </Text>
      </View>
      <Text style={styles.change}>{value ? 'Change' : 'Choose'}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen scroll={false}>
      <ScreenHeader compact title="Book for someone else" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {recent.length ? (
          <View style={styles.recent}>
            {recent.map((p) => (
              <Chip
                key={p.name}
                icon="person-outline"
                label={p.name}
                active={cleanName(name).toLowerCase() === p.name.toLowerCase()}
                onPress={() => {
                  setName(p.name);
                  setPhone(p.phone ? prettyPhone(p.phone) : '');
                }}
              />
            ))}
          </View>
        ) : null}

        <Field
          label="Their name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sarah Ahmed"
          autoCapitalize="words"
          maxLength={NAME_MAX}
          returnKeyType="next"
        />
        <Field
          label="Their mobile (recommended)"
          value={phone}
          onChangeText={setPhone}
          placeholder="07123 456789"
          keyboardType="phone-pad"
          maxLength={16}
          error={phoneOk ? null : 'Enter a UK mobile number'}
          hint="The driver can call them, and we text them when the driver is on the way and outside. It is never shown to the driver."
        />

        <View style={styles.journey}>
          {place('Pickup', pickup, 'pickup', 'ellipse-outline')}
          <View style={styles.line} />
          {place('Destination', destination, 'destination', 'flag-outline')}
        </View>
        <Text style={[TYPE.small, { marginTop: SPACE[2] }]}>You can add more drops on the next screen.</Text>

        <View style={{ marginTop: SPACE[4] }}>
          <Banner
            tone="info"
            icon="card-outline"
            body="You pay and can follow the trip in your app. The driver sees their name and that you booked it."
          />
        </View>
      </ScrollView>
      <Footer>
        <Button title="See prices" icon="arrow-forward" onPress={seePrices} />
      </Footer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACE[5], paddingBottom: SPACE[8] },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], marginBottom: SPACE[4] },
  journey: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginTop: SPACE[2],
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], padding: SPACE[4] },
  placeText: { ...TYPE.body, color: COLORS.ink },
  change: { color: COLORS.blue, fontWeight: '700', fontSize: 14 },
  line: { height: 1, backgroundColor: COLORS.line, marginLeft: SPACE[4] + 18 + SPACE[3] },
});
