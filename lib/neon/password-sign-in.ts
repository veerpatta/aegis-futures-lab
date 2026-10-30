import { getNeon } from './client';

type PasswordSignIn = (input: { email: string; password: string }) => Promise<{
  data: { user: { id: string; email?: string; is_anonymous?: boolean } | null };
  error: unknown;
}>;

/** Password is sent only to the existing Neon Auth adapter. Never expose
 * provider error details, and don't treat anonymous sessions as sign-in. */
export async function signInWithPassword(email: string, password: string, signIn: PasswordSignIn = input => getNeon().auth.signInWithPassword(input)) {
  const address = email.trim();
  if (!address || !address.includes('@') || !password) throw new Error('Enter your email and password.');
  try {
    const { data, error } = await signIn({ email: address, password });
    const user = data?.user;
    if (error || !user?.id || !user.email || user.is_anonymous) throw new Error();
    return { id: user.id, email: user.email };
  } catch {
    throw new Error('Could not sign in. Check your email and password and try again.');
  }
}
