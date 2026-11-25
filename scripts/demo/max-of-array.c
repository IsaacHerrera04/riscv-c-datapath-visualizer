// Largest element of an array that also has negative numbers.
// Expected result: max = 42
int main() {
  int v[6];
  int i;
  int max;

  v[0] = 7;
  v[1] = -3;
  v[2] = 42;
  v[3] = 0;
  v[4] = 15;
  v[5] = -100;

  max = v[0];
  for (i = 1; i < 6; i++) {
    if (v[i] > max) {
      max = v[i];
    }
  }

  return max;
}
