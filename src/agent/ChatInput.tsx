import { memo, useRef, useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet, Text } from "react-native";
import { useSessionStore } from "../stores/session-store";
import { Icon } from "../components/Icon";
import { PressableRow } from "../components/PressableRow";
import {
  COMPACT_COMPOSER_ICON_SIZE,
  COMPACT_COMPOSER_STYLES,
} from "../components/compact-composer-styles";
import { THEME } from "../styles/theme";
import { isWeb } from "../constants/platform";

export const ChatInput = memo(function ChatInput({
  // "standalone" (default) draws its own bordered footer for the desktop chat
  // pane. "embedded" drops the top border / background so it can sit inside the
  // mobile floating dock, which already supplies the surface.
  variant = "standalone",
}: {
  variant?: "standalone" | "embedded";
} = {}) {
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const cancelAgent = useSessionStore((state) => state.cancelAgent);
  const isStreaming = useSessionStore((state) => state.isStreaming);
  const agentId = useSessionStore((state) => state.agentId);
  const queued = useSessionStore((s) => s.queued);
  const removeQueued = useSessionStore((s) => s.removeQueued);
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || !agentId) return;

    setText("");
    try {
      // sendMessage transparently queues the message if a turn is already
      // running, so the user can fire off several in a row.
      await sendMessage(trimmed);
    } catch {
      // Error handled in store
    }
  }

  async function handleCancel() {
    try {
      await cancelAgent();
    } catch {
      // Ignore
    }
  }

  // Enter sends; it never inserts a newline. On web we intercept the keydown
  // before react-native-web's textarea inserts the "\n" (and skip while an IME
  // composition is active, so committing Chinese/Japanese candidates with Enter
  // doesn't fire a send). Shift+Enter still adds a newline. On native the same
  // behaviour comes from submitBehavior="submit" (Enter submits, keeps focus,
  // no newline), wired on the TextInput below.
  function handleKeyPress(e: {
    nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
    preventDefault?: () => void;
  }) {
    if (!isWeb) return;
    const ne = e.nativeEvent;
    if (ne.key === "Enter" && !ne.shiftKey && !ne.isComposing && ne.keyCode !== 229) {
      e.preventDefault?.();
      void handleSend();
    }
  }

  return (
    <View style={variant === "embedded" ? styles.containerEmbedded : styles.container}>
      {queued.length > 0 ? (
        <View style={styles.queueList}>
          {queued.length > 1 ? (
            <Text style={styles.queueHint}>
              {queued.length} messages queued · will send together after the current reply
            </Text>
          ) : (
            <Text style={styles.queueHint}>Queued · will send after the current reply</Text>
          )}
          {queued.map((q) => (
            <View key={q.id} style={styles.queueChip}>
              <Text style={styles.queueChipText} numberOfLines={2}>
                {q.text}
              </Text>
              <TouchableOpacity
                style={styles.queueRemove}
                onPress={() => removeQueued(q.id)}
                hitSlop={8}
                accessibilityLabel="Remove queued message"
              >
                <Text style={styles.queueRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {/* Pill-shaped composer matching the document comment bubble: a rounded
            surface field with the send affordance as a round button inside. */}
        <View
          style={variant === "embedded"
            ? [COMPACT_COMPOSER_STYLES.pill, styles.pillFill]
            : styles.pill}
        >
          <TextInput
            ref={inputRef}
            style={variant === "embedded"
              ? [COMPACT_COMPOSER_STYLES.input, styles.inputWeb]
              : styles.input}
            value={text}
            onChangeText={setText}
            placeholder={agentId ? "Ask the AI..." : "Create a session first"}
            placeholderTextColor={THEME.colors.textMuted}
            multiline
            editable={!!agentId}
            onSubmitEditing={handleSend}
            onKeyPress={handleKeyPress}
            submitBehavior="submit"
            returnKeyType="send"
          />
          {/* Send is always available (even mid-turn) so messages can be queued. */}
          <PressableRow
            style={[
              variant === "embedded" ? COMPACT_COMPOSER_STYLES.send : styles.send,
              (!text.trim() || !agentId) && (
                variant === "embedded" ? COMPACT_COMPOSER_STYLES.sendDisabled : styles.sendDisabled
              ),
            ]}
            onPress={handleSend}
            disabled={!text.trim() || !agentId}
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
        </View>
        {/* Stop shows alongside the pill while a turn is running. */}
        {isStreaming ? (
          <TouchableOpacity
            style={[styles.cancelButton, variant === "embedded" && styles.cancelButtonEmbedded]}
            onPress={handleCancel}
            hitSlop={6}
            accessibilityLabel="Stop generating"
          >
            <Icon name="stop" size={16} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  // Inside the dock: no chrome (the dock card owns the surface/border).
  containerEmbedded: {
    gap: 3,
  },
  queueList: {
    gap: THEME.spacing.xs,
    marginBottom: THEME.spacing.xs,
  },
  queueHint: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    paddingHorizontal: THEME.spacing.xs,
  },
  queueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  queueChipText: {
    flex: 1,
    fontSize: 13,
    color: THEME.colors.text,
  },
  queueRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.2)",
  },
  queueRemoveText: {
    fontSize: 15,
    lineHeight: 17,
    color: THEME.colors.textSecondary,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  // Rounded composer pill (standalone: floating with border + shadow), mirroring
  // the document comment bubble so the two inputs read as the same component.
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: THEME.radii.full,
    paddingLeft: THEME.spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.35)",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  pillFill: {
    flex: 1,
  },
  input: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 14,
    color: THEME.colors.text,
    maxHeight: 88,
    // Kill react-native-web's native focus outline on the underlying textarea.
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  inputWeb: {
    ...(isWeb ? { outlineStyle: "none" as unknown as undefined } : null),
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.primary,
    overflow: "hidden",
  },
  sendInner: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    backgroundColor: "rgba(148,163,184,0.4)",
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.error,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  cancelButtonEmbedded: {
    width: 30,
    height: 30,
  },
});
