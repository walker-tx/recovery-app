import { DropdownMenu, DropdownMenuItem, Host, Text } from '@expo/ui/jetpack-compose';
import type { CountOverflowProps } from './count-overflow';
export function CountOverflow({ disabled, onEdit, onDelete }: CountOverflowProps) {
  return <Host style={{ minWidth: 90, height: 48 }}><DropdownMenu>
    <DropdownMenu.Trigger><Text>More ⋮</Text></DropdownMenu.Trigger>
    <DropdownMenu.Items>
      <DropdownMenuItem enabled={!disabled} onClick={onEdit}><DropdownMenuItem.Text><Text>Edit</Text></DropdownMenuItem.Text></DropdownMenuItem>
      <DropdownMenuItem enabled={!disabled} onClick={onDelete}><DropdownMenuItem.Text><Text>Delete</Text></DropdownMenuItem.Text></DropdownMenuItem>
    </DropdownMenu.Items>
  </DropdownMenu></Host>;
}
