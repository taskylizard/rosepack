import { isAbsolute, relative, resolve, sep } from 'node:path'

export function resolveFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path)
}

export function isInside(directory: string, file: string): boolean {
  const child = relative(directory, file)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}
