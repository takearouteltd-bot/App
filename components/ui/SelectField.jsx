// components/ui/SelectField.jsx
// A dropdown that matches the kit's Field: tap it, pick from a sheet.
import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOW, SPACE, TYPE } from './kit';

/**
 * options  [{ value, label, detail? }]
 * value    the selected option's value, or null
 */
export default function SelectField({ label, value, options, onChange, placeholder = 'Choose', hint, error, style, title, renderTrigger }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) || null;

  // A custom trigger (e.g. a settings row) instead of the field box.
  if (renderTrigger) {
    return (
      <>
        {renderTrigger(() => setOpen(true), selected)}
        {sheet()}
      </>
    );
  }

  function sheet() {
    return (
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{title || label || 'Choose one'}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => String(o.value)}
              style={{ maxHeight: 420 }}
              ListEmptyComponent={<Text style={[TYPE.small, { paddingVertical: SPACE[4] }]}>Nothing to choose from yet.</Text>}
              renderItem={({ item }) => {
                const on = item.value === value;
                return (
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, on && { color: COLORS.navy, fontWeight: '700' }]}>{item.label}</Text>
                      {item.detail ? <Text style={TYPE.small}>{item.detail}</Text> : null}
                    </View>
                    {on ? <Ionicons name="checkmark" size={20} color={COLORS.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <View style={[{ marginBottom: SPACE[4] }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.box, error && { borderColor: COLORS.red }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${label || title || 'Choose'}: ${selected ? selected.label : 'not chosen'}`}
      >
        <Text style={[styles.value, !selected && { color: COLORS.faint }]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
      </TouchableOpacity>
      {error ? (
        <Text style={[TYPE.small, { color: COLORS.red, marginTop: SPACE[1] }]}>{error}</Text>
      ) : hint ? (
        <Text style={[TYPE.small, { marginTop: SPACE[1] }]}>{hint}</Text>
      ) : null}

      {sheet()}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: COLORS.navy, marginBottom: SPACE[2] },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: 50, paddingHorizontal: SPACE[4],
    borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineStrong,
    backgroundColor: COLORS.white,
  },
  value: { flex: 1, fontSize: 15, color: COLORS.ink },
  backdrop: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE[5], paddingTop: SPACE[3], paddingBottom: SPACE[8],
    ...SHADOW.sheet,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line, alignSelf: 'center', marginBottom: SPACE[4] },
  title: { ...TYPE.heading, marginBottom: SPACE[2] },
  option: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: SPACE[3],
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line,
  },
  optionText: { fontSize: 16, color: COLORS.ink },
});
