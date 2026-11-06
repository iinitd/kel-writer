import { View, StyleSheet } from "react-native";
import { SharedHtmlRendererNative } from "./SharedHtmlRenderer.native";
import type { EditorViewProps } from "./EditorView.types";

export function EditorView(props: EditorViewProps) {
  return (
    <View style={styles.container}>
      <SharedHtmlRendererNative {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
  },
});
