# Architecture — 2 Microservices, 2 Exposure Models

Project có hai business microservices: **Order** và **Catalog**. Mục tiêu là tách rõ service ownership, Docker network boundary và public exposure boundary.

## Business ownership

```text
Order Service                          Catalog Service
- create/list orders                   - list products
- customer snapshot                    - price + stock
- persist order                        - reserve stock
       |                                      |
       v                                      v
   PostgreSQL                               Redis
```

Order gọi Catalog bằng REST. Order không đọc Redis trực tiếp; Catalog không đọc PostgreSQL trực tiếp.

## Network model chung

```text
                     service-net
             +-----------------------+
             |                       |
             v                       v
       order-service ----------> catalog-service
             |                       |
      order-data-net          catalog-data-net
             |                       |
             v                       v
          postgres                  redis
```

| Component | service-net | order-data-net | catalog-data-net |
|---|:---:|:---:|:---:|
| Order | ✅ | ✅ | ❌ |
| Catalog | ✅ | ❌ | ✅ |
| PostgreSQL | ❌ | ✅ | ❌ |
| Redis | ❌ | ❌ | ✅ |

---

# Case 1 — một public BFF, native backend private

Deployment: `compose.yaml`.

```text
                         INTERNET
                            |
                         HTTPS
                            |
                            v
                         ngrok
                            |
                         edge-net
                            |
                            v
                    +---------------+
                    | Frontend/BFF  |
                    +-------+-------+
                            |
                       service-net
                    /               \
                   v                 v
            order-service -----> catalog-service
                 |                    |
          order-data-net       catalog-data-net
                 |                    |
             PostgreSQL              Redis
```

Ngrok chỉ có đường tới BFF. Order/Catalog không có public endpoint riêng và không publish host port.

Public BFF contract:

```text
GET  /shop/products
GET  /shop/orders
POST /shop/checkout
GET  /shop/system
```

Native backend routes không được proxy ra ngoài:

```text
/api/order/*    -> 404
/api/catalog/*  -> 404
```

External client vẫn có thể gọi `/shop/checkout` vì đó là public BFF contract. Case 1 bảo vệ **native microservice interface**, không phải phân biệt browser với Postman.

---

# Case 2 — ba public ngrok endpoint độc lập

Deployment: `compose.public.yaml`.

Case 2 không dùng shared Nginx Gateway.

```text
                         INTERNET
            +---------------+---------------+
            |               |               |
            v               v               v
      ngrok-frontend    ngrok-order     ngrok-catalog
            |               |               |
            v               v               v
       frontend        order-service    catalog-service
                           |                 |
                    order-data-net    catalog-data-net
                           |                 |
                       PostgreSQL           Redis
```

Mỗi public component có URL riêng:

```text
https://<frontend>.ngrok-free.app/
https://<order>.ngrok-free.app/orders
https://<catalog>.ngrok-free.app/products
```

Không có shared path kiểu:

```text
/frontend-ngrok/api/order/...
/frontend-ngrok/api/catalog/...
```

Browser tải React từ frontend tunnel. Sau đó React discover runtime URL của Order/Catalog và gọi trực tiếp hai backend tunnel.

```text
Browser -> ngrok-frontend -> frontend-service
Browser -> ngrok-order    -> order-service
Browser -> ngrok-catalog  -> catalog-service
```

Do các origin khác nhau, Order và Catalog bật CORS cho demo. Đây là browser interoperability, không phải security boundary.

Internal microservice call vẫn giữ private:

```text
order-service -> service-net -> catalog-service:8002
```

Order không đi vòng ra Internet/ngrok để reserve stock.

---

# So sánh exposure boundary

```text
CASE 1
Internet -> ngrok -> BFF -> private native Order/Catalog APIs

CASE 2
Internet -> ngrok-frontend -> Frontend
Internet -> ngrok-order    -> Order API
Internet -> ngrok-catalog  -> Catalog API
```

| | Case 1 | Case 2 |
|---|---|---|
| Frontend public | ✅ | ✅ |
| Order có public URL riêng | ❌ | ✅ |
| Catalog có public URL riêng | ❌ | ✅ |
| Host publish 8002/8003 | ❌ | ❌ |
| Database public | ❌ | ❌ |
| Order -> Catalog nội bộ | ✅ | ✅ |

Điểm khác biệt chính là **backend có public endpoint riêng hay không**, không phải `ports:`.

---

# Ngrok và Docker ports

`EXPOSE` hoặc container port không tự public ra host.

```text
8002/tcp
```

trong `docker compose ps` không tương đương:

```text
0.0.0.0:8002->8002/tcp
```

Case 2 chứng minh một service vẫn có thể public Internet qua ngrok dù không publish host port.

---

# Persistence

- PostgreSQL -> named volume `order-data`.
- Redis -> AOF + named volume `catalog-data`.
- `docker compose down` giữ volumes.
- `docker compose down -v` xóa volumes.
- Ngrok URLs có thể thay đổi khi tunnel được tạo lại.

# Dependency graph

```text
Redis healthy ------> Catalog healthy ----+
                                          |
Postgres healthy ------------------------> Order healthy
                                          |
Catalog healthy --------------------------+
```

Case 1:

```text
Order + Catalog healthy -> Frontend/BFF healthy -> ngrok starts
```

Case 2:

```text
Frontend healthy -> ngrok-frontend
Order healthy    -> ngrok-order
Catalog healthy  -> ngrok-catalog
```

# Boundary proof

Order thấy Catalog:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Order không thấy Redis:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
```

Catalog không thấy PostgreSQL:

```powershell
docker compose -f compose.public.yaml exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```
