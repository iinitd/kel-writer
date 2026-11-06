import { memo } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import {
  COMPACT_COMPOSER_ICON_SIZE,
  COMPACT_COMPOSER_STYLES,
} from "../components/compact-composer-styles";
import { useEditorStore } from "../stores/editor-store";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

interface DocumentCommentBarProps {
  // The currently-highlighted passage, if any. When present it's shown as a
  // context chip and passed to the agent along with the comment; when null the
  // comment applies to the whole document.
  selectionText: string | null;
  // A tapped image / whiteboard reference, if any. Mutually exclusive with a
  // text selection: it's shown as a distinct chip and routed to the agent as an
  // asset reference by the caller.
  imageRef?: { label: string; kind: "image" | "whiteboard" } | null;
  // Send the comment to the agent. `selectionText` (or null) is attached by the
  // caller. Return once dispatched/queued.
  onSend: (comment: string) => void | Promise<void>;
  secondaryAction?: { label: string; onSend: (comment: string) => void | Promise<void> };
  // Clear the active selection (dismiss the context chip without sending).
  onClearSelection?: () => void;
  // "standalone" (default) draws its own padded footer for the desktop editor.
  // "embedded" drops the outer chrome so it can be stacked inside the mobile
  // floating dock directly above the tab bar.
  variant?: "standalone" | "embedded";
}

// A persistent bar for commenting on the document. It's always available: with
// a selection it carries the highlighted passage as context, without one it
// sends a document-scoped comment. Typing here never spawns a separate popover —
// the input is inline.
export const DocumentCommentBar = memo(function DocumentCommentBar({
  selectionText,
  imageRef,
  onSend,
  secondaryAction,
  onClearSelection,
  variant = "standalone",
}: DocumentCommentBarProps) {
  // The draft lives in the editor store, not local state, so an AI revise that
  // reloads the document mid-typing can't wipe what the user has typed. Worst
  // case the highlighted reference clears; the text stays put.
  const comment = useEditorStore((s) => s.commentDraft);
  const setComment = useEditorStore((s) => s.setCommentDraft);
  const hasSelection = !!selectionText && selectionText.trim().length > 0;
  const hasImageRef = !!imageRef;
  // Either kind of reference (text or asset) lets an empty comment through with
  // a default instruction.
  const hasRef = hasSelection || hasImageRef;

  const submit = async () => {
    const trimmed = comment.trim();
    // Allow an empty comment only when there's a reference (defaults to a
    // "polish this" instruction); a doc-scoped send needs some text.
    if (!trimmed && !hasRef) return;
    setComment("");
    await onSend(trimmed);
  };

  const submitSecondary = async () => {
    const trimmed = comment.trim();
    if (!trimmed && !hasRef) return;
    if (!secondaryAction) return;
    setComment("");
    await secondaryAction.onSend(trimmed);
  };

  // Enter sends; it never inserts a newline. On web we intercept the keydown
  // before react-native-web's textarea inserts "\n" (and bail while an IME
  // composition is active so committing candidates doesn't send). Shift+Enter
  // still adds a newline. Native gets the same via submitBehavior="submit".
  const handleKeyPress = (e: {
    nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
    preventDefault?: () => void;
  }) => {
    if (!isWeb) return;
    const ne = e.nativeEvent;
    if (ne.key === "Enter" && !ne.shiftKey && !ne.isComposing && ne.keyCode !== 229) {
      e.preventDefault?.();
      void submit();
    }
  };

  return (
    <View style={variant === "embedded" ? styles.barEmbedded : styles.bar}>
      {hasSelection ? (
        <View style={styles.chipRow}>
          <Text style={styles.chipQuote}>“</Text>
          <Text style={styles.chipText} numberOfLines={1}>
            {selectionText}
          </Text>
          {onClearSelection ? (
            <PressableRow onPress={onClearSelection} hitSlop={8} haptic="light" scale={0.9}>
              <Text style={styles.chipClear}>✕</Text>
            </PressableRow>
          ) : null}
        </View>
      ) : hasImageRef ? (
        <View style={[styles.chipRow, styles.chipRowAsset]}>
          <Text style={styles.chipAssetIcon}>
            {imageRef!.kind === "whiteboard" ? "▧" : "▦"}
          </Text>
          <Text style={[styles.chipText, styles.chipTextAsset]} numberOfLines={1}>
            {imageRef!.label}
          </Text>
          {onClearSelection ? (
            <PressableRow onPress={onClearSelection} hitSlop={8} haptic="light" scale={0.9}>
              <Text style={[styles.chipClear, styles.chipClearAsset]}>✕</Text>
            </PressableRow>
          ) : null}
        </View>
      ) : null}
      <View style={variant === "embedded" ? COMPACT_COMPOSER_STYLES.pill : styles.pill}>
        <TextInput
          style={variant === "embedded"
            ? [COMPACT_COMPOSER_STYLES.input, styles.inputWeb]
            : styles.input}
          value={comment}
          onChangeText={setComment}
          placeholder={
            hasImageRef
              ? imageRef!.kind === "whiteboard"
                ? "对这块白板说点什么…"
                : "对这张图片说点什么…"
              : hasSelection
                ? "对选中内容说点什么…"
                : "点击输入，评论这篇文档…"
          }
          placeholderTextColor={THEME.colors.textMuted}
          returnKeyType="send"
          onSubmitEditing={submit}
          onKeyPress={handleKeyPress}
          submitBehavior="submit"
          multiline
        />
        <PressableRow
          style={[
            variant === "embedded" ? COMPACT_COMPOSER_STYLES.send : styles.send,
            !comment.trim() && !hasRef && (
              variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendDisabled : styles.sendDisabled
            ),
          ]}
          onPress={submit}
          disabled={!comment.trim() && !hasRef}
          haptic="medium"
          scale={0.92}
        >
          <View style={variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendInner : styles.sendInner}>
            <Icon
              name="send"
              size={variant === "embedded" ? COMPACT_COMPOSER_ICON_SIZE : 16}
              color="#fff"
            />
          </View>
        </PressableRow>
        {secondaryAction ? (
          <PressableRow
            style={[styles.secondaryAction, !comment.trim() && !hasRef && styles.secondaryActionDisabled]}
            onPress={submitSecondary}
            disabled={!comment.trim() && !hasRef}
            haptic="light"
            scale={0.95}
          >
            <Text style={styles.secondaryActionText}>{secondaryAction.label}</Text>
          </PressableRow>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.sm,
    paddingBottom: THEME.spacing.md,
    backgroundColor: "transparent",
    gap: THEME.spacing.xs,
  },
  // Inside the dock: no outer padding/background (the dock provides both), and
  // the input pill is flat (no shadow/border) since it shares the dock card.
  barEmbedded: {
    gap: THEME.spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "#fef9c3",
    borderRadius: THEME.radii.full,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 5,
    marginLeft: THEME.spacing.xs,
  },
  chipQuote: {
    fontSize: 13,
    color: "#a16207",
    fontWeight: "700",
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    color: "#713f12",
  },
  chipClear: {
    fontSize: 12,
    color: "#92400e",
    fontWeight: "700",
    paddingLeft: 4,
  },
  // Asset (image / whiteboard) reference chip — a cool slate tint to read
  // distinctly from the yellow text-selection chip.
  chipRowAsset: {
    backgroundColor: "#e2e8f0",
  },
  chipAssetIcon: {
    fontSize: 13,
    color: "#475569",
  },
  chipTextAsset: {
    color: "#334155",
  },
  chipClearAsset: {
    color: "#475569",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: THEME.radii.full,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.35)",
    // Soft floating shadow to lift the pill off the document.
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  input: {
    flex: 1,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 6,
    fontSize: 15,
    color: THEME.colors.text,
    maxHeight: 100,
    // Kill react-native-web's native focus outline on the underlying textarea.
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  inputWeb: {
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.primary,
    overflow: "hidden",
  },
  sendInner: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: "rgba(148,163,184,0.4)",
  },
  secondaryAction: {
    marginLeft: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: THEME.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.background,
  },
  secondaryActionDisabled: { opacity: 0.45 },
  secondaryActionText: {
    color: THEME.colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
});
