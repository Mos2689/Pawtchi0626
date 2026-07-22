import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, space } from '../constants/design';
import { PawtchiButton } from './PawtchiButton';
import { toAppError, reportError } from '../lib/appError';

/**
 * Last-resort catch for render crashes — the one failure class no try/catch
 * at a call site can reach. Wraps the root navigator (app/_layout.tsx).
 *
 * Recovery is a full remount: bumping the key throws away the crashed React
 * subtree and rebuilds from the navigator down. Auth/session state lives in
 * providers ABOVE this boundary, so the user lands back on their screen
 * signed in, not at the welcome video.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  crashed: boolean;
  resetKey: number;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { crashed: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const appErr = toAppError(error);
    appErr.technical = `${appErr.technical} | component stack: ${(info.componentStack ?? '').slice(0, 400)}`;
    reportError(appErr, 'render_crash');
  }

  private handleRestart = () => {
    this.setState((s) => ({ crashed: false, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.crashed) {
      return (
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="pets" size={34} color={color.navy} />
          </View>
          <Text style={styles.title}>Pawtchi hit a snag</Text>
          <Text style={styles.message}>
            Everything is safe — your pet’s data isn’t affected. Let’s pick up where you left off.
          </Text>
          <View style={styles.actionWrap}>
            <PawtchiButton title="Start again" variant="primary" iconName="refresh" onPress={this.handleRestart} />
          </View>
        </View>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    paddingHorizontal: space.xxl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.yellowSoft,
    marginBottom: space.lg,
  },
  title: {
    fontFamily: font.display,
    fontSize: 30,
    color: color.ink,
    textAlign: 'center',
  },
  message: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.md,
    maxWidth: 300,
  },
  actionWrap: {
    alignSelf: 'stretch',
    marginTop: space.xxl,
  },
});
