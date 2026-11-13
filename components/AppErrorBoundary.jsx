/* A screen that hits an error while drawing shows this instead of closing
   the app, and the error is logged (utils/errorLog.js). "Back to start"
   rebuilds the navigation from the top. */
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, COLORS, SPACE, TYPE } from './ui/kit';
import { logAppError } from '../utils/errorLog';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logAppError(error, { componentStack: info?.componentStack, screen: this.props.getScreen?.(), kind: 'render' });
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={styles.wrap}>
        <View style={styles.inner}>
          <Ionicons name="alert-circle-outline" size={44} color={COLORS.midnight} />
          <Text style={[TYPE.title, styles.center, { marginTop: SPACE[3] }]}>Something went wrong</Text>
          <Text style={[TYPE.body, styles.center, { marginTop: SPACE[2], color: COLORS.inkSoft }]}>
            Sorry, that screen hit a problem and we've been told about it. Any trip you're on carries on.
          </Text>
          <Button title="Back to start" style={{ marginTop: SPACE[5], alignSelf: 'stretch' }} onPress={this.reset} />
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.surface },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE[6] },
  center: { textAlign: 'center' },
});
