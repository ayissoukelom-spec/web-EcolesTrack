import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomDropdown from './CustomDropdown';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CustomDropdown popup positioning', () => {
  it('positions an open popup against the viewport rather than document scroll coordinates', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 24,
      y: 180,
      top: 180,
      right: 224,
      bottom: 220,
      left: 24,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });

    render(
      <CustomDropdown
        value=""
        options={[{ value: '2010', label: '2010' }]}
        onChange={() => undefined}
        placeholder="Année"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Année/ }));
    const popup = screen.getByRole('listbox').parentElement;

    expect(popup?.style.position).toBe('fixed');
    expect(popup?.style.top).toBe('226px');
    expect(popup?.style.left).toBe('24px');
  });

  it('opens above a trigger when the popup would exceed the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 24,
      y: 500,
      top: 500,
      right: 224,
      bottom: 540,
      left: 24,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

    render(
      <CustomDropdown
        value=""
        options={[{ value: '2010', label: '2010' }]}
        onChange={() => undefined}
        placeholder="Année"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Année/ }));

    expect(screen.getByRole('listbox').parentElement?.style.top).toBe('270px');
  });
});

describe('CustomDropdown dismissal', () => {
  const options = [
    { value: '2010', label: '2010' },
    { value: '2011', label: '2011' },
  ];

  it('closes on an outside pointer interaction without changing the selection', () => {
    const onChange = vi.fn();
    render(<CustomDropdown value="2010" options={options} onChange={onChange} placeholder="Année" />);

    fireEvent.click(screen.getByRole('button', { name: /2010/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on a touch outside the trigger and portal', () => {
    render(<CustomDropdown value="" options={options} onChange={() => undefined} placeholder="Année" />);

    fireEvent.click(screen.getByRole('button', { name: /Année/ }));
    fireEvent.touchStart(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<CustomDropdown value="" options={options} onChange={() => undefined} placeholder="Année" />);

    fireEvent.click(screen.getByRole('button', { name: /Année/ }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not close for an interaction inside the portal and closes after selection', () => {
    const onChange = vi.fn();
    render(<CustomDropdown value="" options={options} onChange={onChange} placeholder="Année" />);

    fireEvent.click(screen.getByRole('button', { name: /Année/ }));
    const option = screen.getByText('2011');
    fireEvent.pointerDown(option);

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith('2011');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps only the selector clicked most recently open', () => {
    render(
      <>
        <CustomDropdown value="" options={options} onChange={() => undefined} placeholder="Jour" />
        <CustomDropdown value="" options={options} onChange={() => undefined} placeholder="Mois" />
      </>,
    );

    const dayTrigger = screen.getByRole('button', { name: /Jour/ });
    const monthTrigger = screen.getByRole('button', { name: /Mois/ });
    fireEvent.click(dayTrigger);
    expect(dayTrigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.pointerDown(monthTrigger);
    fireEvent.click(monthTrigger);

    expect(dayTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(monthTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
  });
});
