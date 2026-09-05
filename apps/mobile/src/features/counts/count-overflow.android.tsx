import { useEffect, useState } from 'react';
import { Button, DropdownMenu, DropdownMenuItem, Host, Text } from '@expo/ui/jetpack-compose';
import type { CountOverflowProps } from './count-overflow';
export function CountOverflow({ disabled, onEdit, onDelete }: CountOverflowProps) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (disabled) setExpanded(false); }, [disabled]);
  return <Host style={{ minWidth: 120, height: 48 }}><DropdownMenu expanded={expanded && !disabled} onDismissRequest={() => setExpanded(false)}>
    <DropdownMenu.Trigger><Button enabled={!disabled} onClick={() => setExpanded(true)}><Text>More actions</Text></Button></DropdownMenu.Trigger>
    <DropdownMenu.Items>
      <DropdownMenuItem enabled={!disabled} onClick={() => { setExpanded(false); if (!disabled) onEdit(); }}><DropdownMenuItem.Text><Text>Edit</Text></DropdownMenuItem.Text></DropdownMenuItem>
      <DropdownMenuItem enabled={!disabled} onClick={() => { setExpanded(false); if (!disabled) onDelete(); }}><DropdownMenuItem.Text><Text>Delete</Text></DropdownMenuItem.Text></DropdownMenuItem>
    </DropdownMenu.Items>
  </DropdownMenu></Host>;
}
