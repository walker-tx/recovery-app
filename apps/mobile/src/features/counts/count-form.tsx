import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Typography } from '@/components/ui/text';
import { countNameError, toLocalMidnight, type CountDraft } from './count-form-policy';

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
      <Button variant="secondary" disabled={disabled} accessibilityLabel={`Start date: ${draft.startAt === null ? 'Choose date' : new Date(draft.startAt).toLocaleDateString()}`}
        onPress={() => {
          setPickerDate(new Date(draft.startAt ?? Date.now()));
          setShowDate(!showDate);
        }}>
        {draft.startAt === null ? 'Choose date' : new Date(draft.startAt).toLocaleDateString()}
      </Button>
      {showDate && !disabled ? <><DateTimePicker value={pickerDate} mode="date" maximumDate={new Date()}
        display={Platform.OS === 'ios' ? 'inline' : 'default'}
        onDismiss={() => setShowDate(false)}
        onValueChange={(_, date) => {
          setPickerDate(date);
          if (Platform.OS !== 'ios') {
            onChange({ ...draft, startAt: toLocalMidnight(date) });
            setShowDate(false);
          }
        }} />
        {Platform.OS === 'ios' ? <Button variant="secondary" onPress={() => {
          onChange({ ...draft, startAt: toLocalMidnight(pickerDate) });
          setShowDate(false);
        }}>Done</Button> : null}
      </> : null}
    </View>
  </View>;
}
