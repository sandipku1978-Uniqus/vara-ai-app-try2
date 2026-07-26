import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BooleanSyntaxHelp, {
  BOOLEAN_OPERATORS,
  BOOLEAN_UNSUPPORTED,
} from '../components/research/BooleanSyntaxHelp';
import ActiveQueryChips from '../components/research/ActiveQueryChips';
import { parseBooleanQuery } from '../utils/booleanSearch';

describe('BooleanSyntaxHelp', () => {
  it('renders nothing until opened', () => {
    const { container } = render(<BooleanSyntaxHelp open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('documents every operator the engine actually parses', () => {
    // The reference is only useful if it matches the parser. Each documented
    // example must survive parsing — a stale table is worse than none.
    for (const operator of BOOLEAN_OPERATORS) {
      const parsed = parseBooleanQuery(operator.example.replace(/auditor:\S+/i, 'kpmg'));
      expect(parsed.error, `${operator.token}: ${operator.example}`).toBeUndefined();
      expect(parsed.expression, `${operator.token} must parse`).not.toBeNull();
    }
  });

  it('names the operators it does NOT support rather than staying silent', () => {
    render(<BooleanSyntaxHelp open onClose={() => {}} />);
    // A researcher arriving from another platform will type these.
    for (const operator of BOOLEAN_UNSUPPORTED) {
      expect(screen.getByText(operator.token)).toBeTruthy();
    }
    // The warning section exists exactly when there is something to warn
    // about — as of engine v4 the list is empty and the section is absent.
    if (BOOLEAN_UNSUPPORTED.length > 0) {
      expect(screen.getByText(/ignored rather than matched/i)).toBeTruthy();
    } else {
      expect(screen.queryByText(/ignored rather than matched/i)).toBeNull();
    }
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<BooleanSyntaxHelp open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('is a labelled dialog, not an unnamed popup', () => {
    render(<BooleanSyntaxHelp open onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: /boolean syntax/i })).toBeTruthy();
  });
});

describe('ActiveQueryChips', () => {
  it('states the search as executed', () => {
    render(
      <ActiveQueryChips
        mode="boolean"
        query='"material weakness"'
        forms={['10-K', '10-K/A']}
        dateFrom="2015-01-01"
      />
    );
    expect(screen.getByText('"material weakness"')).toBeTruthy();
    expect(screen.getByText('10-K, 10-K/A')).toBeTruthy();
    expect(screen.getByText(/2015-01-01 – latest/)).toBeTruthy();
  });

  it('marks an issuer the engine inferred, so a wrong one is visible', () => {
    // Exactly the failure this exists to expose: `"material weakness"` was
    // being rewritten into an issuer scope plus a text fragment, and nothing
    // on screen said so.
    render(
      <ActiveQueryChips
        mode="boolean"
        query='weakness"'
        entityName="Material Resource Acquisition Corp."
        forms={[]}
      />
    );
    const chip = screen.getByText('Material Resource Acquisition Corp.').closest('span');
    expect(chip?.parentElement?.className).toContain('derived');
    expect(screen.getByText(/inferred from your query/i)).toBeTruthy();
  });

  it('renders nothing when no condition is active', () => {
    const { container } = render(<ActiveQueryChips mode="semantic" query="" forms={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
