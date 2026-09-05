import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Typography } from '@/components/ui/text';
import { countNameError, countPickerValue, countPickerStartAt, type CountDraft } from './count-form-policy';

export type CountFormProps = {
  draft: CountDraft;
  onChange: (draft: CountDraft) => void;
  disabled?: boolean;
  nameNotice?: ReactNode;
};

export function CountForm({ draft, onChange, disabled = false, nameNotice }: CountFormProps) {
  const [showDate, setShowDate] = useState(false);
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const [nameTouched, setNameTouched] = useState(false);
  return <View className="gap-xl">
    <TextField label="Name" placeholder="What are you counting?" description="A behavior or substance. Don’t know what to call it? Something generic like ‘Sobriety’ might work." value={draft.name} editable={!disabled} autoCapitalize="sentences"
      onBlur={() => setNameTouched(true)}
      onChangeText={(name) => onChange({ ...draft, name })}
      error={nameTouched || draft.name.length > 0 ? countNameError(draft.name) : null} />
    {nameNotice}
    <View className="gap-sm">
      <Typography variant="label">Start date</Typography>
      <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled, expanded: showDate && !disabled }}
        className="flex-row items-center justify-between rounded-md border border-line bg-surface px-md active:opacity-70"
        style={{ minHeight: 48, paddingVertical: 10, gap: 12 }} accessibilityLabel={`Start date: ${draft.startAt === null ? 'Choose date' : new Date(draft.startAt).toLocaleDateString()}`}
        onPress={() => {
          setPickerDate(new Date(draft.startAt ?? Date.now()));
          setShowDate(!showDate);
        }}>
        <Typography className={disabled ? 'text-ink-muted' : 'text-ink'} style={{ flex: 1, fontSize: 14.5, textAlign: 'left' }}>{draft.startAt === null ? 'Choose date' : new Date(draft.startAt).toLocaleDateString()}</Typography>
        <Typography accessibilityElementsHidden importantForAccessibility="no">›</Typography>
      </Pressable>
      {showDate && !disabled ? <><DateTimePicker value={countPickerValue(pickerDate, Platform.OS)} mode="date" maximumDate={new Date()}
        display={Platform.OS === 'ios' ? 'inline' : 'default'}
        onDismiss={() => setShowDate(false)}
        onValueChange={(_, date) => {
          if (Platform.OS === 'ios') setPickerDate(date);
          if (Platform.OS !== 'ios') {
            onChange({ ...draft, startAt: countPickerStartAt(date, Platform.OS, draft.startAt) });
            setShowDate(false);
          }
        }} />
        {Platform.OS === 'ios' ? <Button variant="secondary" onPress={() => {
          onChange({ ...draft, startAt: countPickerStartAt(pickerDate, 'ios', draft.startAt) });
          setShowDate(false);
        }}>Done</Button> : null}
      </> : null}
    </View>
  </View>;
}
