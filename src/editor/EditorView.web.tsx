import { View, StyleSheet } from "react-native";
import { SharedHtmlRendererWeb } from "./SharedHtmlRenderer.web";
import type { EditorViewProps } from "./EditorView.types";

export function EditorView(props: EditorViewProps) {
  return (
    <View style={styles.container}>
      <SharedHtmlRendererWeb {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
  },
});
