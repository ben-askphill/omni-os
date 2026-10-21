/** The Home greeting for an hour of the day, with the user's name when Settings has one. */
export function greeting(hour: number, name: string) {
  const base = hour < 5 ? 'Late one' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return name ? `${base}, ${name}` : base;
}
