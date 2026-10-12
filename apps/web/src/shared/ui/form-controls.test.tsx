import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormAlert, SubmitButton, TextField } from './form-controls';

describe('form controls', () => {
  it('labels the input and links the error to it for assistive technology', () => {
    render(<TextField id="email" name="email" label="Email" error="Enter a valid email address." hint="We never share it." />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    expect(screen.getByText('Enter a valid email address.').id).toBe('email-error');
    expect(screen.getByText('We never share it.')).toBeTruthy();
  });

  it('has no error attributes while valid', () => {
    render(<TextField id="name" name="name" label="Name" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders alerts and a submit button that disables while pending', () => {
    render(
      <>
        <FormAlert>Something failed</FormAlert>
        <SubmitButton pending idle="Go" busy="Going…" />
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Something failed');
    const button = screen.getByRole('button', { name: 'Going…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
