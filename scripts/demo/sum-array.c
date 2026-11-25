// Sum of an array: fills v with 1..5, then adds its elements.
// Expected result: sum = 15
int main() {
  int v[5];
  int i;
  int sum = 0;

  for (i = 0; i < 5; i++) {
    v[i] = i + 1;
  }

  for (i = 0; i < 5; i++) {
    sum += v[i];
  }

  return sum;
}
