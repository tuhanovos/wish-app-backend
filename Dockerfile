FROM node:18-alpine

# Устанавливаем зависимости для сборки нативного кода
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Копируем package.json отдельно для кэширования
COPY package*.json ./

# Устанавливаем зависимости и принудительно пересобираем sqlite3
RUN npm install
RUN npm rebuild sqlite3 --target_platform=linux --target_arch=x64

# Копируем остальные файлы
COPY . .

# Проверяем, что бинарник существует
RUN ls -la node_modules/sqlite3/build/Release/ || echo "Binary not found"

EXPOSE 80

CMD ["node", "server.js"]
