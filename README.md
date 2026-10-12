# Microservice Compose Demo

Repo co 2 case demo.

Case 1: ngrok -> Nginx -> backend private

Case 2: 1 ngrok agent tao 3 public URL cho Frontend, Order, Catalog

## Chuan bi

Dien ngrok token vao file `.env`:

```env
NGROK_AUTHTOKEN=your_token
```

Cap nhat code:

```cmd
git pull
```

## Case 1

Chay:

```cmd
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lay URL ngrok:

```cmd
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Lay `public_url` trong JSON. Vi du:

```text
https://xxxx.ngrok-free.app
```

Test Frontend va Nginx reverse proxy:

```cmd
curl -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/shop/products
curl -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/shop/orders
curl -i -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/api/order/orders
```

Ket qua mong doi:

```text
/shop/products       200
/shop/orders         200
/api/order/orders    404
```

Postman tao order Case 1:

```text
Method: POST
URL: https://xxxx.ngrok-free.app/shop/checkout
Header: Content-Type: application/json
Header: ngrok-skip-browser-warning: 1
Body: raw JSON
```

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 1
}
```

Test backend khong publish ra host:

```cmd
curl http://localhost:8002/products
curl http://localhost:8003/orders
```

Hai lenh tren phai fail.

Test Nginx goi Catalog trong Docker network:

```cmd
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```

Test network:

```cmd
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

Ket qua mong doi:

```text
Order thay Catalog
Order khong thay Redis
Catalog khong thay PostgreSQL
```

Xem log ngrok neu co loi:

```cmd
docker compose logs ngrok
```

Dung Case 1:

```cmd
docker compose down
```

## Case 2

Chay:

```cmd
docker compose -f compose.public.yaml down -v --remove-orphans
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lay 3 URL ngrok:

```cmd
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tim 3 tunnel:

```text
frontend
order
catalog
```

Test:

```cmd
curl -H "ngrok-skip-browser-warning: 1" https://ORDER_URL/orders
curl -H "ngrok-skip-browser-warning: 1" https://CATALOG_URL/products
```

Mo `FE_URL` tren browser de test frontend.

Postman tao order Case 2:

```text
Method: POST
URL: https://ORDER_URL/orders
Header: Content-Type: application/json
Header: ngrok-skip-browser-warning: 1
Body: raw JSON
```

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 1
}
```

Curl tao order:

```cmd
curl -X POST "https://ORDER_URL/orders" -H "Content-Type: application/json" -H "ngrok-skip-browser-warning: 1" -d "{\"customer_name\":\"Nguyen Van An\",\"customer_email\":\"an@example.com\",\"product_id\":1,\"quantity\":1}"
```

Test backend khong publish ra host:

```cmd
curl http://localhost:8002/products
curl http://localhost:8003/orders
```

Hai lenh tren phai fail.

Test Order goi Catalog noi bo:

```cmd
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Test database:

```cmd
docker compose -f compose.public.yaml exec postgres psql -U shopuser -d shopdb -c "SELECT customer_name, product_name, quantity, total FROM orders ORDER BY created_at DESC;"
```

Test Redis:

```cmd
docker compose -f compose.public.yaml exec redis redis-cli HGETALL product:1
```

Xem log ngrok neu co loi:

```cmd
docker compose -f compose.public.yaml logs ngrok
```

Dung Case 2:

```cmd
docker compose -f compose.public.yaml down
```
