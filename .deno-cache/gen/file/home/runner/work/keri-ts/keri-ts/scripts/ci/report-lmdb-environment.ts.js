/**
 * Print the LMDB package version and directory visible from the current Deno
 * working directory.
 *
 * CI environment assertions call this instead of embedding a Node heredoc in a
 * shell script. The upward walk mirrors how local commands discover the nearest
 * workspace `node_modules/lmdb` installation.
 */ /** Return the parent directory for a POSIX-style path. */ function dirname(path) {
  // Strip trailing slashes first so `/a/b/` reports `/a` instead of `/a/b`.
  const clean = path.replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index <= 0 ? "/" : clean.slice(0, index);
}
/** Test path existence while preserving non-NotFound filesystem errors. */ function exists(path) {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}
/** Find the nearest ancestor containing `node_modules/lmdb`. */ function findLmdbDir() {
  let dir = Deno.cwd();
  while(dir !== dirname(dir)){
    const candidate = `${dir}/node_modules/lmdb`;
    if (exists(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}
try {
  const lmdbDir = findLmdbDir();
  if (!lmdbDir) {
    throw new Error("lmdb not installed");
  }
  const pkg = JSON.parse(Deno.readTextFileSync(`${lmdbDir}/package.json`));
  console.log(`lmdb: ${pkg.version}`);
  console.log(`lmdb dir: ${lmdbDir}`);
} catch  {
  console.log("lmdb: not installed");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZpbGU6Ly8vaG9tZS9ydW5uZXIvd29yay9rZXJpLXRzL2tlcmktdHMvc2NyaXB0cy9jaS9yZXBvcnQtbG1kYi1lbnZpcm9ubWVudC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFByaW50IHRoZSBMTURCIHBhY2thZ2UgdmVyc2lvbiBhbmQgZGlyZWN0b3J5IHZpc2libGUgZnJvbSB0aGUgY3VycmVudCBEZW5vXG4gKiB3b3JraW5nIGRpcmVjdG9yeS5cbiAqXG4gKiBDSSBlbnZpcm9ubWVudCBhc3NlcnRpb25zIGNhbGwgdGhpcyBpbnN0ZWFkIG9mIGVtYmVkZGluZyBhIE5vZGUgaGVyZWRvYyBpbiBhXG4gKiBzaGVsbCBzY3JpcHQuIFRoZSB1cHdhcmQgd2FsayBtaXJyb3JzIGhvdyBsb2NhbCBjb21tYW5kcyBkaXNjb3ZlciB0aGUgbmVhcmVzdFxuICogd29ya3NwYWNlIGBub2RlX21vZHVsZXMvbG1kYmAgaW5zdGFsbGF0aW9uLlxuICovXG5cbi8qKiBSZXR1cm4gdGhlIHBhcmVudCBkaXJlY3RvcnkgZm9yIGEgUE9TSVgtc3R5bGUgcGF0aC4gKi9cbmZ1bmN0aW9uIGRpcm5hbWUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gU3RyaXAgdHJhaWxpbmcgc2xhc2hlcyBmaXJzdCBzbyBgL2EvYi9gIHJlcG9ydHMgYC9hYCBpbnN0ZWFkIG9mIGAvYS9iYC5cbiAgY29uc3QgY2xlYW4gPSBwYXRoLnJlcGxhY2UoL1xcLyskLywgXCJcIik7XG4gIGNvbnN0IGluZGV4ID0gY2xlYW4ubGFzdEluZGV4T2YoXCIvXCIpO1xuICByZXR1cm4gaW5kZXggPD0gMCA/IFwiL1wiIDogY2xlYW4uc2xpY2UoMCwgaW5kZXgpO1xufVxuXG4vKiogVGVzdCBwYXRoIGV4aXN0ZW5jZSB3aGlsZSBwcmVzZXJ2aW5nIG5vbi1Ob3RGb3VuZCBmaWxlc3lzdGVtIGVycm9ycy4gKi9cbmZ1bmN0aW9uIGV4aXN0cyhwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBEZW5vLnN0YXRTeW5jKHBhdGgpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLk5vdEZvdW5kKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHRocm93IGVycm9yO1xuICB9XG59XG5cbi8qKiBGaW5kIHRoZSBuZWFyZXN0IGFuY2VzdG9yIGNvbnRhaW5pbmcgYG5vZGVfbW9kdWxlcy9sbWRiYC4gKi9cbmZ1bmN0aW9uIGZpbmRMbWRiRGlyKCk6IHN0cmluZyB8IG51bGwge1xuICBsZXQgZGlyID0gRGVuby5jd2QoKTtcbiAgd2hpbGUgKGRpciAhPT0gZGlybmFtZShkaXIpKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gYCR7ZGlyfS9ub2RlX21vZHVsZXMvbG1kYmA7XG4gICAgaWYgKGV4aXN0cyhjYW5kaWRhdGUpKSB7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlO1xuICAgIH1cbiAgICBkaXIgPSBkaXJuYW1lKGRpcik7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbnRyeSB7XG4gIGNvbnN0IGxtZGJEaXIgPSBmaW5kTG1kYkRpcigpO1xuICBpZiAoIWxtZGJEaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJsbWRiIG5vdCBpbnN0YWxsZWRcIik7XG4gIH1cbiAgY29uc3QgcGtnID0gSlNPTi5wYXJzZShEZW5vLnJlYWRUZXh0RmlsZVN5bmMoYCR7bG1kYkRpcn0vcGFja2FnZS5qc29uYCkpO1xuICBjb25zb2xlLmxvZyhgbG1kYjogJHtwa2cudmVyc2lvbn1gKTtcbiAgY29uc29sZS5sb2coYGxtZGIgZGlyOiAke2xtZGJEaXJ9YCk7XG59IGNhdGNoIHtcbiAgY29uc29sZS5sb2coXCJsbWRiOiBub3QgaW5zdGFsbGVkXCIpO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7O0NBT0MsR0FFRCx3REFBd0QsR0FDeEQsU0FBUyxRQUFRLElBQVk7RUFDM0IsMEVBQTBFO0VBQzFFLE1BQU0sUUFBUSxLQUFLLE9BQU8sQ0FBQyxRQUFRO0VBQ25DLE1BQU0sUUFBUSxNQUFNLFdBQVcsQ0FBQztFQUNoQyxPQUFPLFNBQVMsSUFBSSxNQUFNLE1BQU0sS0FBSyxDQUFDLEdBQUc7QUFDM0M7QUFFQSx5RUFBeUUsR0FDekUsU0FBUyxPQUFPLElBQVk7RUFDMUIsSUFBSTtJQUNGLEtBQUssUUFBUSxDQUFDO0lBQ2QsT0FBTztFQUNULEVBQUUsT0FBTyxPQUFPO0lBQ2QsSUFBSSxpQkFBaUIsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFO01BQ3pDLE9BQU87SUFDVDtJQUNBLE1BQU07RUFDUjtBQUNGO0FBRUEsOERBQThELEdBQzlELFNBQVM7RUFDUCxJQUFJLE1BQU0sS0FBSyxHQUFHO0VBQ2xCLE1BQU8sUUFBUSxRQUFRLEtBQU07SUFDM0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxrQkFBa0IsQ0FBQztJQUM1QyxJQUFJLE9BQU8sWUFBWTtNQUNyQixPQUFPO0lBQ1Q7SUFDQSxNQUFNLFFBQVE7RUFDaEI7RUFDQSxPQUFPO0FBQ1Q7QUFFQSxJQUFJO0VBQ0YsTUFBTSxVQUFVO0VBQ2hCLElBQUksQ0FBQyxTQUFTO0lBQ1osTUFBTSxJQUFJLE1BQU07RUFDbEI7RUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLENBQUMsS0FBSyxnQkFBZ0IsQ0FBQyxHQUFHLFFBQVEsYUFBYSxDQUFDO0VBQ3RFLFFBQVEsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLElBQUksT0FBTyxFQUFFO0VBQ2xDLFFBQVEsR0FBRyxDQUFDLENBQUMsVUFBVSxFQUFFLFNBQVM7QUFDcEMsRUFBRSxPQUFNO0VBQ04sUUFBUSxHQUFHLENBQUM7QUFDZCJ9
// denoCacheMetadata=14597736620385657246,11855731173744639322