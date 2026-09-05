import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/text';

// Keep query failures local: in particular, duplicate lookup must never destroy a draft.
export class CountQueryBoundary extends Component<{ children: ReactNode; message: string; recovery?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <>
      <Typography accessibilityRole="alert">{this.props.message}</Typography>
      {this.props.recovery}
      <Button variant="secondary" onPress={() => this.setState({ failed: false })}>Try again</Button>
    </>;
  }
}
