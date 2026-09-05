import { Button, Host, Menu } from '@expo/ui/swift-ui';
import { disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers';
import type { CountOverflowProps } from './count-overflow';
export function CountOverflow({ disabled, onEdit, onDelete }: CountOverflowProps) {
  return <Host style={{ minWidth: 90, height: 48 }}><Menu label="More" systemImage="ellipsis" modifiers={[disabledModifier(disabled)]}>
    <Button label="Edit" systemImage="pencil" onPress={onEdit} />
    <Button label="Delete" systemImage="trash" role="destructive" onPress={onDelete} />
  </Menu></Host>;
}
