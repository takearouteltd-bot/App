import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { useAppConfig, money } from '../../../utils/appConfig';
import {
  referralsEnabled,
  myReferralCode,
  applyReferralCode,
  shareText,
  creditPounds,
} from '../../../utils/referrals';
import { openTerms } from '../../../utils/legal';
import {
  COLORS,
  TYPE,
  SPACE,
  Screen,
  ScreenHeader,
  Section,
  Card,
  Banner,
  Button,
  Field,
  StatRow,
  EmptyState,
} from '../../../components/ui/kit';

/* Invite friends (functions/referrals.js). The passenger's own code to
   share, their ride credit, and a box for a friend's code before their own
   first trip. Only reachable while invite-a-friend is on; the server checks
   everything again whatever this screen shows. */
export default function InviteFriendsScreen() {
  const uid = auth.currentUser?.uid;
  const config = useAppConfig();
  const on = referralsEnabled(config);
  const r = config.referrals || {};

  const [code, setCode] = useState(null);
  const [codeError, setCodeError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [credit, setCredit] = useState(null);
  const [mine, setMine] = useState(null);
  const [entered, setEntered] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    const quiet = () => {};
    const stops = [
      onSnapshot(doc(db, 'referralProfiles', uid), (s) => setProfile(s.exists() ? s.data() : {}), quiet),
      onSnapshot(doc(db, 'riderCredit', uid), (s) => setCredit(s.exists() ? s.data() : {}), quiet),
      onSnapshot(doc(db, 'referrals', uid), (s) => setMine(s.exists() ? s.data() : null), quiet),
    ];
    return () => stops.forEach((stop) => stop());
  }, [uid]);

  useEffect(() => {
    if (!uid || !on) return;
    let live = true;
    myReferralCode()
      .then((c) => live && setCode(c))
      .catch((e) => live && setCodeError(e?.message || 'Your code could not be loaded.'));
    return () => {
      live = false;
    };
  }, [uid, on]);

  if (!on) {
    return (
      <Screen>
        <ScreenHeader title="Invite friends" />
        <EmptyState icon="gift-outline" title="Not running right now" body="Invite a friend isn't running at the moment. Any ride credit you already have still comes off your next card trip." />
      </Screen>
    );
  }

  const balance = creditPounds(credit);
  const share = async () => {
    if (!code) return;
    try {
      await Share.share({ message: shareText(code, config) });
    } catch (e) {
      // Closed the sheet, or no app to share with: nothing to do.
    }
  };

  const apply = async () => {
    if (!entered.trim() || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await applyReferralCode(entered);
      setApplied(true);
      setEntered('');
    } catch (e) {
      setApplyError(e?.message || 'That code could not be used. Try again.');
    } finally {
      setApplying(false);
    }
  };

  // A friend's code can be entered once, before the first trip.
  const canEnter = !mine && !profile?.referredBy && !applied;
  const giveText = Number(r.newRiderReward) > 0 ? money(r.newRiderReward) : null;
  const getText = Number(r.referrerReward) > 0 ? money(r.referrerReward) : null;
  const minFareText = Number(r.minTripFare) > 0 ? ` (${money(r.minTripFare)} or more)` : '';
  const rewardText = [getText ? `you get ${getText}` : null, giveText ? `they get ${giveText}` : null]
    .filter(Boolean)
    .join(' and ');

  return (
    <Screen>
      <ScreenHeader
        title="Invite friends"
        subtitle={
          giveText && getText
            ? `Give ${giveText}, get ${getText} in ride credit.`
            : giveText
            ? `Your friends get ${giveText} in ride credit.`
            : `You get ${getText} in ride credit for each friend.`
        }
      />

      <Card tone="dark" style={styles.codeCard}>
        <Text style={styles.codeLabel}>Your invite code</Text>
        <Text style={styles.code} selectable>
          {code || (codeError ? '—' : '…')}
        </Text>
        {codeError ? <Text style={styles.codeNote}>{codeError}</Text> : null}
        <Button title="Share your code" variant="accent" icon="share-social-outline" onPress={share} disabled={!code} style={{ marginTop: SPACE[4] }} />
      </Card>

      <StatRow
        style={{ marginTop: SPACE[5] }}
        items={[
          { value: money(balance), label: 'ride credit' },
          { value: Number(profile?.invited) || 0, label: 'friends joined' },
          { value: Number(profile?.rewarded) || 0, label: 'took a trip' },
        ]}
      />
      {balance > 0 ? (
        <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
          Your ride credit comes off your next card trip automatically. At least {money(0.5)} is always charged to your card.
        </Text>
      ) : null}

      {mine?.status === 'pending' ? (
        <View style={{ marginTop: SPACE[5] }}>
          <Banner
            title="Your friend's code is saved"
            body={`Take your first trip paid by card${Number(r.minTripFare) > 0 ? ` of ${money(r.minTripFare)} or more` : ''} and your ride credit is added.`}
          />
        </View>
      ) : null}
      {applied ? (
        <View style={{ marginTop: SPACE[5] }}>
          <Banner tone="success" title="Code saved" body="Your ride credit is added after your first trip paid by card." />
        </View>
      ) : null}

      {canEnter ? (
        <Section title="Have a friend's code?">
          <Field
            placeholder="Enter invite code"
            value={entered}
            onChangeText={(t) => {
              setEntered(t);
              setApplyError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            left="gift-outline"
            error={applyError}
            hint="Only before your first trip, and only once."
          />
          <Button title="Use code" variant="secondary" onPress={apply} loading={applying} disabled={!entered.trim()} />
        </Section>
      ) : null}

      <Section title="How it works">
        <Text style={TYPE.body}>
          1. Share your code with a friend who hasn't used TakeARoute.{'\n'}
          2. They sign up with their phone number and enter it before their first trip.{'\n'}
          3. When they finish their first trip paid by card{minFareText}, {rewardText} in ride credit.
        </Text>
        <Text style={[TYPE.small, { marginTop: SPACE[3] }]}>
          One invite per person and phone number. Cash trips don't count. Ride credit can't be swapped for cash.
        </Text>
        <Button title="Terms of use" variant="ghost" size="small" style={{ alignSelf: 'flex-start', marginTop: SPACE[2] }} onPress={openTerms} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeCard: { marginTop: SPACE[4], alignItems: 'stretch' },
  codeLabel: { color: '#AEB5C4', fontSize: 13, fontWeight: '600' },
  code: { color: COLORS.lime, fontSize: 34, fontWeight: '800', letterSpacing: 4, marginTop: SPACE[2] },
  codeNote: { color: '#AEB5C4', fontSize: 13, marginTop: SPACE[2] },
});
