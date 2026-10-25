/**
 * Every word in sign-up v2, in one place.
 *
 * Headings follow the walk viewer's voice ("Bruno, Tuesday morning."): a
 * sentence-case line with its closing punctuation split out, because the
 * screen sets that one character in the brand yellow. `{name}` is replaced
 * with the dog's name once it is known. Brand copy spec: sentence case, no
 * exclamation marks (copy.test.ts holds every string to it).
 */

export interface Heading {
  title: string;
  end: '.' | '?';
}

export const signupCopy = {
  name: {
    heading: { title: 'Who are we walking with', end: '?' } as Heading,
    sub: "Your dog's name. You can change it later.",
    placeholder: 'Bruno',
    cta: 'Next',
  },
  photo: {
    heading: { title: "Add {name}'s photo", end: '.' } as Heading,
    sub: "It's how friends spot {name} on a shared walk.",
    add: 'Add a photo',
    change: 'Change photo',
    opening: 'Opening your photos…',
    cta: 'Next',
    skip: 'Skip for now',
  },
  breed: {
    heading: { title: 'What breed is {name}', end: '?' } as Heading,
    sub: "Helps Pawtchi read {name}'s pace on a walk.",
    search: 'Search all breeds',
    popular: 'Popular',
    matches: 'Matches',
    allBreeds: 'All breeds',
    useTyped: 'Use "{query}"',
    cta: 'Next',
    skip: 'Not sure',
  },
  age: {
    heading: { title: 'How old is {name}', end: '?' } as Heading,
    sub: 'Years, roughly.',
    puppy: 'Puppy',
    cta: 'Next',
    skip: 'Skip',
  },
  firstDog: {
    heading: { title: 'Is {name} your first dog', end: '?' } as Heading,
    sub: 'Tap one to carry on.',
    yes: 'My first',
    yesCaption: 'Learning together',
    no: 'There have been others',
    noCaption: 'Been here before',
    skip: 'Skip',
  },
  walkers: {
    heading: { title: 'Who walks {name}', end: '?' } as Heading,
    sub: 'The people who take {name} out regularly.',
    few: 'One or two of us',
    fewCaption: 'Just me, or me and one other',
    many: 'Three or more',
    manyCaption: 'A whole pack',
    skip: 'Skip',
  },
  account: {
    heading: { title: 'Last step. Save {name}', end: '.' } as Heading,
    usernameLabel: 'Username',
    optional: 'optional',
    usernamePlaceholder: 'bella_and_sam',
    usernameHint: 'How friends invite you on a walk.',
    usernameError: 'Use 3–24 lowercase letters, numbers or underscores.',
    usernameTaken: 'That username is taken. Try another, or leave it empty for now.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    passwordPlaceholder: 'At least 8 characters',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    cta: 'Create account',
    haveAccount: 'Already have an account?',
    signIn: 'Sign in',
    noticeLead:
      'We collect your email and the pet details you enter to work out feeding, hydration and activity targets. Read our',
    privacy: 'Privacy Policy',
    and: 'and',
    terms: 'Terms of Service',
  },
  finish: {
    saving: { title: 'Saving {name}', end: '.' } as Heading,
    savingSub: 'Setting up the map and the first page of the logbook.',
    welcome: { title: 'Welcome, {name}', end: '.' } as Heading,
    welcomeSub: 'Every walk from here is kept.',
    cta: "Let's walk",
    usernameTaken: { title: '@{username} was just taken', end: '.' } as Heading,
    usernameTakenSub: 'Pick another, or skip it and choose one later.',
    usernameUse: 'Use this username',
    usernameSkip: 'Skip for now',
    failed: { title: "{name} isn't saved yet", end: '.' } as Heading,
    retry: 'Try again',
  },
  back: 'Back',
} as const;

/** Put the dog's name (and anything else) into a line. */
export function fillCopy(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
