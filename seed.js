const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.user.createMany({
    data: [
      { email: 'admin@corp.io', name: 'Admin', passwordHash: 'admin', role: 'ADMIN' },
      { email: 'manager@corp.io', name: 'Manager', passwordHash: 'manager', role: 'MANAGER' },
      { email: 'user@corp.io', name: 'User', passwordHash: 'user', role: 'USER' }
    ]
  });
  console.log('Users seeded successfully!');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
