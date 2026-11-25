// Counts the bits set to 1 in x, shifting it right until it is 0.
// Expected result: count = 6   (0x5A3 = 0101 1010 0011)
int main() {
  int x = 0x5A3;
  int count = 0;

  while (x != 0) {
    count += x & 1;
    x = x >> 1;
  }

  return count;
}
