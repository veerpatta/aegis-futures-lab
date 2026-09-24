/** Public Neon endpoints. Database credentials stay server-side. */
export const NEON_AUTH_URL = process.env.NEXT_PUBLIC_NEON_AUTH_URL ||
  'https://ep-twilight-recipe-b3apaham.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';

export const NEON_DATA_API_URL = process.env.NEXT_PUBLIC_NEON_DATA_API_URL ||
  'https://ep-twilight-recipe-b3apaham.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
