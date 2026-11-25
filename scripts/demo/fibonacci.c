// First 12 Fibonacci numbers (a nod to the hardware's "fibona" program memory).
// Expected result: fib = 0 1 1 2 3 5 8 13 21 34 55 89
int main() {
  int fib[12];
  int i;

  fib[0] = 0;
  fib[1] = 1;
  for (i = 2; i < 12; i++) {
    fib[i] = fib[i - 1] + fib[i - 2];
  }

  return fib[11];
}
