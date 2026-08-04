import { describe, expect, it } from 'vitest';
import { buildOwnershipRenderedPath, describeTransactionCode, parseOwnershipDocument } from '../utils/ownershipForm';

/**
 * Fixture shaped after the filing from the user report (Rocky Brands Form 4,
 * accession 0001225208-26-006896): option exercise (M) plus a derivative row,
 * footnotes, and the relationship block.
 */
const FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0609</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-07-31</periodOfReport>
  <issuer>
    <issuerCik>0000895456</issuerCik>
    <issuerName>ROCKY BRANDS, INC.</issuerName>
    <issuerTradingSymbol>RCKY</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001349868</rptOwnerCik>
      <rptOwnerName>Jordan William L</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerAddress>
      <rptOwnerCity>NELSONVILLE</rptOwnerCity>
      <rptOwnerState>OH</rptOwnerState>
    </reportingOwnerAddress>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>CEO</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock, without par value</value></securityTitle>
      <transactionDate><value>2026-07-31</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>M</transactionCode>
        <equitySwapInvolved>0</equitySwapInvolved>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>3000.0000</value></transactionShares>
        <transactionPricePerShare><value>19.02</value><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>45000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Stock Option (right to buy)</value></securityTitle>
      <conversionOrExercisePrice><value>19.02</value></conversionOrExercisePrice>
      <transactionDate><value>2026-07-31</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>3000</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <exerciseDate><value>2026-07-31</value></exerciseDate>
      <expirationDate><value>2031-05-10</value></expirationDate>
      <underlyingSecurity>
        <underlyingSecurityTitle><value>Common Stock</value></underlyingSecurityTitle>
        <underlyingSecurityShares><value>3000</value></underlyingSecurityShares>
      </underlyingSecurity>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>12000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </derivativeTransaction>
  </derivativeTable>
  <footnotes>
    <footnote id="F1">Exercise price of options granted under the 2014 plan.</footnote>
  </footnotes>
  <remarks>Filed by authorized signatory.</remarks>
</ownershipDocument>`;

describe('parseOwnershipDocument', () => {
  it('parses the Form 4 shape end to end', () => {
    const doc = parseOwnershipDocument(FORM4_XML);
    expect(doc).not.toBeNull();
    expect(doc!.documentType).toBe('4');
    expect(doc!.issuerName).toBe('ROCKY BRANDS, INC.');
    expect(doc!.issuerTradingSymbol).toBe('RCKY');
    expect(doc!.periodOfReport).toBe('2026-07-31');

    expect(doc!.reportingOwners).toHaveLength(1);
    expect(doc!.reportingOwners[0].name).toBe('Jordan William L');
    expect(doc!.reportingOwners[0].location).toBe('NELSONVILLE, OH');
    expect(doc!.reportingOwners[0].isDirector).toBe(true);
    expect(doc!.reportingOwners[0].officerTitle).toBe('CEO');

    expect(doc!.nonDerivative).toHaveLength(1);
    const txn = doc!.nonDerivative[0];
    expect(txn.securityTitle).toBe('Common Stock, without par value');
    expect(txn.code).toBe('M');
    expect(txn.shares).toBe('3000.0000');
    expect(txn.pricePerShare).toBe('19.02');
    expect(txn.acquiredDisposed).toBe('A');
    expect(txn.sharesOwnedAfter).toBe('45000');
    expect(txn.ownershipForm).toBe('D');
    expect(txn.footnoteIds).toEqual(['F1']);

    expect(doc!.derivative).toHaveLength(1);
    expect(doc!.derivative[0].exercisePrice).toBe('19.02');
    expect(doc!.derivative[0].expirationDate).toBe('2031-05-10');
    expect(doc!.derivative[0].underlyingTitle).toBe('Common Stock');

    expect(doc!.footnotes).toEqual([{ id: 'F1', text: 'Exercise price of options granted under the 2014 plan.' }]);
    expect(doc!.remarks).toBe('Filed by authorized signatory.');
  });

  it('returns null for non-ownership XML and for HTML', () => {
    expect(parseOwnershipDocument('<html><body>10-K</body></html>')).toBeNull();
    expect(parseOwnershipDocument('<otherRoot><a/></otherRoot>')).toBeNull();
    expect(parseOwnershipDocument('')).toBeNull();
  });

  it('labels the common transaction codes', () => {
    expect(describeTransactionCode('M')).toMatch(/exercise/i);
    expect(describeTransactionCode('S')).toMatch(/sale/i);
    expect(describeTransactionCode('ZZ')).toBe('');
  });
});

describe('buildOwnershipRenderedPath', () => {
  it('maps modern schemas to the current stylesheet', () => {
    expect(buildOwnershipRenderedPath('1349868', '000122520826006896', 'doc4.xml', 'X0609'))
      .toBe('Archives/edgar/data/1349868/000122520826006896/xslF345X05/doc4.xml');
  });
  it('maps older generations to their stylesheets', () => {
    expect(buildOwnershipRenderedPath('1', '2', 'doc.xml', 'X0306')).toContain('xslF345X02');
    expect(buildOwnershipRenderedPath('1', '2', 'doc.xml', 'X0402')).toContain('xslF345X03');
    expect(buildOwnershipRenderedPath('1', '2', 'doc.xml', 'X0508')).toContain('xslF345X04');
  });
});
