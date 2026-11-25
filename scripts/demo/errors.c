// Program with semantic errors: the compiler reports all of them with their lines.
int main() {
  int a;
  int v[4];

  a = b + 1;
  a = 5000;
  v[4] = a;
  a = a << 32;
  a[0] = 1;
}
