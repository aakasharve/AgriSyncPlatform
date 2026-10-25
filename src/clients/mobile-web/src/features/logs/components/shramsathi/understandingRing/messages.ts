// The reward line under the ring. Rules already in the app: the score is Sathi's understanding, not a grade
// of the farmer – never a 0, never "कमी"/deficit wording; missing things are an invitation to tell more.
// "{n}" marks the number the engine rolls (from the total down to the missed count).

export type Numerals = 'deva' | 'latin';
const DEV = '०१२३४५६७८९';

export function digits(n: number, numerals: Numerals = 'deva'): string {
  const s = String(n);
  return numerals === 'latin' ? s : s.replace(/\d/g, (d) => DEV[Number(d)]);
}

export type MessageFn = (score: number, total: number, missed: number) => [title: string, sub: string];

export const defaultMessage: MessageFn = (score, total, missed) => {
  if (score >= total) return ['वा! आजचं सगळं समजलं!', 'तुमच्या शेतीचं आजचं पूर्ण चित्र समजलं.'];
  const many = score / total >= 0.6;
  if (missed > 0) {
    return many
      ? ['छान! तुम्ही बऱ्याच गोष्टी सांगितल्या आहेत!', 'आणखी {n} गोष्टी सांगाल, तेव्हा आम्हाला तुमच्या शेतीचं संपूर्ण चित्र समजेल.']
      : ['छान सुरुवात!', 'आणखी {n} गोष्टी सांगा — मग आजचं चित्र पूर्ण होईल.'];
  }
  return many
    ? ['छान! बरंच समजलं!', 'अजून थोडं सांगाल, तर आजचं चित्र पूर्ण होईल.']
    : ['छान सुरुवात!', 'आज काय काय झालं, ते थोडं अजून सांगा.'];
};
