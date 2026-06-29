import { registerRootComponent } from "expo";
import React from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { App } from "./App";

type EBState = { hasError: boolean };

// React.Component<{}, EBState> → children this.props.children üzerinden erişilir.
class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, EBState> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const self = this;
      return React.createElement(
        View,
        { style: styles.container },
        React.createElement(Text, { style: styles.title }, "Bir şeyler ters gitti"),
        React.createElement(
          Text,
          { style: styles.body },
          "Uygulamayı kapatıp tekrar açmayı dene.",
        ),
        React.createElement(
          Pressable,
          { style: styles.btn, onPress: () => self.setState({ hasError: false }) },
          React.createElement(Text, { style: styles.btnText }, "Tekrar Dene"),
        ),
      );
    }
    return this.props.children as React.ReactNode;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0e1a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  title: { color: "#f1f5f9", fontSize: 22, fontWeight: "800", textAlign: "center" },
  body: { color: "#94a3b8", fontSize: 15, textAlign: "center", lineHeight: 22 },
  btn: {
    marginTop: 8,
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

const Root = (): React.ReactElement =>
  React.createElement(ErrorBoundary, null, React.createElement(App)) as React.ReactElement;

registerRootComponent(Root);
