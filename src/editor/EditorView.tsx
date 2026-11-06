import { View, StyleSheet } from "react-native";
import { isWeb } from "../constants/platform";
import { SharedHtmlRendererWeb } from "./SharedHtmlRenderer.web";
import { SharedHtmlRendererNative } from "./SharedHtmlRenderer.native";
import type { EditorViewProps } from "./EditorView.types";

export function EditorView({
  hideInlineCommentBar,
  onRequestFiles,
  onRequestAgent,
  active,
}: EditorViewProps) {
  if (isWeb) {
    return (
      <View style={styles.container}>
        <SharedHtmlRendererWeb
          hideInlineCommentBar={hideInlineCommentBar}
          onRequestFiles={onRequestFiles}
          onRequestAgent={onRequestAgent}
          active={active}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SharedHtmlRendererNative
        hideInlineCommentBar={hideInlineCommentBar}
        onRequestFiles={onRequestFiles}
        onRequestAgent={onRequestAgent}
        active={active}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
  },
});
