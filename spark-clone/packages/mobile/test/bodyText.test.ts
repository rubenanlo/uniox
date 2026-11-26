import { describe, expect, it } from 'vitest';
import { bodyText, looksLikeHtml, markupToText } from '../src/lib/bodyText';

describe('email body text for chat bubbles', () => {
  it('turns stray <br> tags in a plain part into line breaks (Petit Bateau)', () => {
    const plain =
      "Chère/Cher Ruben, <br><br>\nVous l'attendiez... votre colis arrive aujourd'hui ! <br><br><br>\nLivraison à domicile ? <br>Gardez votre téléphone.<br>\nA très vite ! <br>\nL'équipe Petit Bateau";
    expect(bodyText(plain, null)).toBe(
      "Chère/Cher Ruben,\n\nVous l'attendiez... votre colis arrive aujourd'hui !\n\nLivraison à domicile ?\nGardez votre téléphone.\nA très vite !\nL'équipe Petit Bateau",
    );
  });

  it('rebuilds the text from the HTML part when the plain part is markup', () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><p>Bonjour,</p><table><tr><td>Détails de commande</td></tr><tr><td>Transporteur :</td><td>Colissimo</td></tr><tr><td>N° de colis :</td><td>6M22848114138</td></tr></table><div>Expédié le&nbsp;: 25/11/2026</div></body></html>';
    expect(bodyText('Bonjour,<br>Détails de commandeTransporteur : Colissimo', html)).toBe(
      'Bonjour,\n\nDétails de commande\nTransporteur : Colissimo\nN° de colis : 6M22848114138\n\nExpédié le : 25/11/2026',
    );
  });

  it('keeps a normal plain part and tidies Gmail link targets', () => {
    expect(bodyText('Hi *Ruben*,\nSee the doc <https://x.com/a>\nThanks', '<p>ignored</p>')).toBe(
      'Hi Ruben,\nSee the doc\nThanks',
    );
  });

  it('falls back to the HTML part when there is no plain part', () => {
    expect(bodyText(null, '<div>One</div><div>Two &amp; three</div>')).toBe('One\nTwo & three');
    expect(bodyText('', null)).toBeNull();
  });

  it('does not mistake addresses or arrows for markup', () => {
    expect(looksLikeHtml('Write to <a.smith@x.com> or <bob@x.com>')).toBe(false);
    expect(looksLikeHtml('line<br/>next')).toBe(true);
  });

  it('collapses source whitespace in real HTML and drops invisible padding', () => {
    expect(markupToText('<p>Hello\n   world</p>&#8204;&zwnj;<p>Bye</p>')).toBe('Hello world\n\nBye');
  });
});
