import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedWordToast } from './SavedWordToast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SavedWordToast', () => {
  it('announces a saved word and dismisses automatically after five seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<SavedWordToast id="event-1" word="overwhelmed" onDismiss={onDismiss} />);

    expect(screen.getByRole('status').textContent).toContain('overwhelmed đã lưu');
    act(() => vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledWith('event-1');
  });

  it('pauses while hovered and can be dismissed by the user', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<SavedWordToast id="event-2" word="relieved" onDismiss={onDismiss} />);
    const toast = screen.getByTestId('saved-word-toast');

    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(6000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo lưu từ relieved' }));
    expect(onDismiss).toHaveBeenCalledWith('event-2');
  });
});
