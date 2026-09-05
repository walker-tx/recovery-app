import { Pressable, View } from 'react-native';
import { Typography } from '@/components/ui/text';

type CountFormHeaderProps = {
  title: string;
  cancelDisabled: boolean;
  saveDisabled: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
};

// Create and Edit share presentation; navigation and persistence stay with each screen.
export function CountFormHeader({ title, cancelDisabled, saveDisabled, pending, onCancel, onSave }: CountFormHeaderProps) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <Pressable accessibilityRole="button" disabled={cancelDisabled} accessibilityState={{ disabled: cancelDisabled }} onPress={onCancel}
      className="active:opacity-70" style={{ flex: 1, minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', paddingVertical: 8 }}>
      <Typography className={cancelDisabled ? 'text-ink-muted' : 'text-ink'} style={{ fontSize: 14 }}>Cancel</Typography>
    </Pressable>
    <Typography accessibilityRole="header" style={{ flex: 2, fontSize: 12, fontWeight: '600', letterSpacing: 1.68, textTransform: 'uppercase', textAlign: 'center' }}>{title}</Typography>
    <Pressable accessibilityRole="button" disabled={saveDisabled} accessibilityState={{ disabled: saveDisabled, busy: pending }} onPress={onSave}
      className="active:opacity-70" style={{ flex: 1, minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'flex-end', paddingVertical: 8 }}>
      <Typography className={saveDisabled ? 'text-ink-muted' : 'text-blueprint'} style={{ fontSize: 14, fontWeight: '600' }}>{pending ? 'Saving…' : 'Save'}</Typography>
    </Pressable>
  </View>;
}
