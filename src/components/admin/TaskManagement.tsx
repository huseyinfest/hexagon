import React, { useState, useEffect } from 'react';
import { ref, get, push, set, update } from 'firebase/database';
import { db } from '../../firebase/config';
import { Task, Product, User, ProductionLine, Warehouse, DeliveryPoint, Truck, PalletStatus } from '../../types';
import { Plus, Package, User as UserIcon, Calendar, MapPin, Clipboard, Trash2, Edit3 } from 'lucide-react';
import { generateUniqueId } from '../../utils/qrGenerator';

const TaskManagement: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [productionLines, setProductionLines] = useState<ProductionLine[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formData, setFormData] = useState({
    productId: '',
    fromType: 'production' as 'production' | 'warehouse',
    fromId: '',
    toType: 'warehouse' as 'warehouse' | 'truck' | 'deliveryPoint',
    toId: '',
    assignedTo: '',
    palletQuantity: 1,
    expirationDate: '',
    productionNumber: 1
  });

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      const [tasksSnapshot, productsSnapshot, usersSnapshot, productionLinesSnapshot, warehousesSnapshot, deliveryPointsSnapshot, trucksSnapshot, settingsSnapshot] = await Promise.all([
        get(ref(db, 'tasks')),
        get(ref(db, 'products')),
        get(ref(db, 'users')),
        get(ref(db, 'productionLines')),
        get(ref(db, 'warehouses')),
        get(ref(db, 'deliveryPoints')),
        get(ref(db, 'trucks')),
        get(ref(db, 'settings'))
      ]);

      const tasksData = tasksSnapshot.exists() 
        ? Object.keys(tasksSnapshot.val()).map(key => ({ id: key, ...tasksSnapshot.val()[key] }))
        : [];

      const productsData = productsSnapshot.exists()
        ? Object.keys(productsSnapshot.val()).map(key => ({ id: key, ...productsSnapshot.val()[key] }))
        : [];

      const usersData = usersSnapshot.exists()
        ? Object.keys(usersSnapshot.val()).map(key => ({ id: key, ...usersSnapshot.val()[key] }))
        : [];

      const productionLinesData = productionLinesSnapshot.exists()
        ? Object.keys(productionLinesSnapshot.val()).map(key => ({ id: key, ...productionLinesSnapshot.val()[key] }))
        : [];

      const warehousesData = warehousesSnapshot.exists()
        ? Object.keys(warehousesSnapshot.val()).map(key => ({ id: key, ...warehousesSnapshot.val()[key] }))
        : [];

      const deliveryPointsData = deliveryPointsSnapshot.exists()
        ? Object.keys(deliveryPointsSnapshot.val()).map(key => ({ id: key, ...deliveryPointsSnapshot.val()[key] }))
        : [];

      const trucksData = trucksSnapshot.exists()
        ? Object.keys(trucksSnapshot.val()).map(key => ({ id: key, ...trucksSnapshot.val()[key] }))
        : [];

      const lastProductionNumber = settingsSnapshot.exists() 
        ? settingsSnapshot.val().lastProductionNumber || 0
        : 0;

      setTasks(tasksData);
      setProducts(productsData);
      setUsers(usersData.filter(user => user.role === 'sofor'));
      setProductionLines(productionLinesData);
      setWarehouses(warehousesData);
      setDeliveryPoints(deliveryPointsData);
      setTrucks(trucksData);
      setFormData(prev => ({ ...prev, productionNumber: lastProductionNumber + 1 }));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const updateTruckInventoryStatus = async (task: Task, newStatus: string) => {
    // Sadece tıra giden görevler için tır envanterini güncelle
    if (task.taskType !== 'productionToTruck' && task.taskType !== 'warehouseToTruck') {
      return;
    }

    try {
      const truckRef = ref(db, `trucks/${task.toId}`);
      const truckSnapshot = await get(truckRef);
      
      if (!truckSnapshot.exists()) return;

      const truck = truckSnapshot.val();
      if (!truck.inventory || !truck.inventory[task.productId]) return;

      const productInventory = truck.inventory[task.productId];
      if (!productInventory.batches) return;

      // Bu göreve ait batch'i bul
      const batchKey = Object.keys(productInventory.batches).find(key => 
        productInventory.batches[key].taskId === task.id
      );

      if (!batchKey) return;

      // Batch durumunu güncelle
      let batchStatus = 'loaded'; // varsayılan durum
      if (newStatus === 'teslim_alma_dogrulama') {
        batchStatus = 'reserved';
      } else if (newStatus === 'devam_ediyor') {
        batchStatus = 'reserved';
      } else if (newStatus === 'tamamlandı') {
        batchStatus = 'loaded';
      }

      await update(ref(db, `trucks/${task.toId}/inventory/${task.productId}/batches/${batchKey}`), {
        status: batchStatus
      });

      console.log(`Tır envanteri güncellendi: ${task.id} -> ${batchStatus}`);
    } catch (error) {
      console.error('Tır envanteri güncellenirken hata:', error);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      // Görev durumunu güncelle
      await update(ref(db, `tasks/${taskId}`), { status: newStatus });

      // Tır envanterini güncelle
      await updateTruckInventoryStatus(task, newStatus);

      // Verileri yenile
      fetchAllData();
      
      alert('Görev durumu başarıyla güncellendi!');
    } catch (error) {
      console.error('Error updating task status:', error);
      alert('Görev durumu güncellenirken bir hata oluştu.');
    }
  };

  const generatePalletQRCodes = (productQrCode: string, productionNumber: number, palletQuantity: number, toLocation: string): string[] => {
    const qrCodes: string[] = [];
    const timestamp = Date.now();
    
    for (let i = 1; i <= palletQuantity; i++) {
      const uniqueId = generateUniqueId();
      const qrCode = `${productQrCode}_${productionNumber}_${i}_${toLocation}_${timestamp}_${uniqueId}`;
      qrCodes.push(qrCode);
    }
    
    return qrCodes;
  };

  const updateInventory = async (task: any, isRemoving: boolean = false) => {
    try {
      if (task.toType === 'warehouse') {
        const warehouseRef = ref(db, `warehouses/${task.toId}`);
        const warehouseSnapshot = await get(warehouseRef);
        
        if (warehouseSnapshot.exists()) {
          const warehouse = warehouseSnapshot.val();
          const inventory = warehouse.inventory || {};
          const productInventory = inventory[task.productId] || { batches: {}, totalPallets: 0 };
          
          const batchId = `batch_${Date.now()}_${generateUniqueId()}`;
          
          if (isRemoving) {
            // Stok çıkarma işlemi (görev silindiğinde)
            const newTotalPallets = Math.max(0, productInventory.totalPallets - task.palletQuantity);
            productInventory.totalPallets = newTotalPallets;
            
            if (newTotalPallets === 0) {
              delete inventory[task.productId];
            } else {
              inventory[task.productId] = productInventory;
            }
          } else {
            // Stok ekleme işlemi
            productInventory.batches[batchId] = {
              productionNumber: task.productionNumber,
              palletQuantity: task.palletQuantity,
              expirationDate: task.expirationDate
            };
            productInventory.totalPallets = (productInventory.totalPallets || 0) + task.palletQuantity;
            inventory[task.productId] = productInventory;
          }
          
          await update(warehouseRef, { inventory });
        }
      } else if (task.toType === 'truck') {
        const truckRef = ref(db, `trucks/${task.toId}`);
        const truckSnapshot = await get(truckRef);
        
        if (truckSnapshot.exists()) {
          const truck = truckSnapshot.val();
          const inventory = truck.inventory || {};
          const productInventory = inventory[task.productId] || { batches: {}, totalPallets: 0 };
          
          const batchId = `batch_${Date.now()}_${generateUniqueId()}`;
          
          if (isRemoving) {
            // Tırdan stok çıkarma
            const batchToRemove = Object.keys(productInventory.batches || {}).find(key => 
              productInventory.batches[key].taskId === task.id
            );
            
            if (batchToRemove) {
              delete productInventory.batches[batchToRemove];
              productInventory.totalPallets = Math.max(0, productInventory.totalPallets - task.palletQuantity);
              
              if (productInventory.totalPallets === 0) {
                delete inventory[task.productId];
              } else {
                inventory[task.productId] = productInventory;
              }
            }
          } else {
            // Tıra stok ekleme (rezerve olarak)
            productInventory.batches[batchId] = {
              productionNumber: task.productionNumber,
              palletQuantity: task.palletQuantity,
              expirationDate: task.expirationDate,
              taskId: task.id,
              status: 'reserved' // Başlangıçta rezerve
            };
            productInventory.totalPallets = (productInventory.totalPallets || 0) + task.palletQuantity;
            inventory[task.productId] = productInventory;
          }
          
          await update(truckRef, { inventory });
        }
      }
    } catch (error) {
      console.error('Error updating inventory:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const product = products.find(p => p.id === formData.productId);
      const fromLocation = formData.fromType === 'production' 
        ? productionLines.find(pl => pl.id === formData.fromId)
        : warehouses.find(w => w.id === formData.fromId);
      
      let toLocation;
      let taskType: 'productionToWarehouse' | 'productionToTruck' | 'warehouseToTruck';
      
      if (formData.toType === 'warehouse') {
        toLocation = warehouses.find(w => w.id === formData.toId);
        taskType = formData.fromType === 'production' ? 'productionToWarehouse' : 'warehouseToTruck';
      } else if (formData.toType === 'truck') {
        toLocation = trucks.find(t => t.id === formData.toId);
        taskType = formData.fromType === 'production' ? 'productionToTruck' : 'warehouseToTruck';
      } else {
        toLocation = deliveryPoints.find(dp => dp.id === formData.toId);
        taskType = 'warehouseToTruck';
      }

      if (!product || !fromLocation || !toLocation) {
        alert('Lütfen tüm alanları doğru şekilde doldurun.');
        return;
      }

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + (product.expiryDays || 30));

      const palletQRCodes = generatePalletQRCodes(
        product.qrCode, 
        formData.productionNumber, 
        formData.palletQuantity, 
        toLocation.name
      );

      const palletStatuses: PalletStatus[] = palletQRCodes.map(code => ({
        code,
        status: 'beklemede'
      }));

      const taskData = {
        productId: formData.productId,
        productName: product.name,
        productQrCode: product.qrCode,
        productionNumber: formData.productionNumber,
        palletQuantity: formData.palletQuantity,
        assignedTo: formData.assignedTo,
        from: fromLocation.name,
        fromQrCode: fromLocation.qrCode,
        fromId: formData.fromId,
        to: toLocation.name,
        toQrCode: toLocation.qrCode,
        toId: formData.toId,
        taskType,
        status: 'teslim_alma_dogrulama',
        createdAt: new Date().toISOString(),
        expirationDate: expirationDate.toISOString(),
        palletQRCodes,
        palletStatuses
      };

      if (editingTask) {
        // Düzenleme işlemi
        await updateInventory({ ...editingTask, toType: getToTypeFromTask(editingTask) }, true);
        await update(ref(db, `tasks/${editingTask.id}`), taskData);
        await updateInventory({ ...taskData, toType: formData.toType });
        alert('Görev başarıyla güncellendi!');
      } else {
        // Yeni görev ekleme
        const newTaskRef = push(ref(db, 'tasks'));
        await set(newTaskRef, taskData);
        await updateInventory({ ...taskData, toType: formData.toType });
        
        // Üretim numarasını güncelle
        await update(ref(db, 'settings'), { lastProductionNumber: formData.productionNumber });
        
        alert('Görev başarıyla oluşturuldu!');
      }

      resetForm();
      fetchAllData();
    } catch (error) {
      console.error('Error creating/updating task:', error);
      alert('Görev oluşturulurken/güncellenirken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const getToTypeFromTask = (task: Task): 'warehouse' | 'truck' | 'deliveryPoint' => {
    if (task.taskType === 'productionToWarehouse') return 'warehouse';
    if (task.taskType === 'productionToTruck' || task.taskType === 'warehouseToTruck') {
      // Tır mı teslimat noktası mı kontrol et
      const isTruck = trucks.some(t => t.id === task.toId);
      return isTruck ? 'truck' : 'deliveryPoint';
    }
    return 'warehouse';
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setFormData({
      productId: task.productId || '',
      fromType: task.taskType.includes('production') ? 'production' : 'warehouse',
      fromId: task.fromId || '',
      toType: getToTypeFromTask(task),
      toId: task.toId || '',
      assignedTo: task.assignedTo,
      palletQuantity: task.palletQuantity,
      expirationDate: task.expirationDate ? new Date(task.expirationDate).toISOString().split('T')[0] : '',
      productionNumber: task.productionNumber
    });
    setShowForm(true);
  };

  const handleDelete = async (taskId: string) => {
    if (window.confirm('Bu görevi silmek istediğinizden emin misiniz?')) {
      try {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          await updateInventory({ ...task, toType: getToTypeFromTask(task) }, true);
        }
        
        await update(ref(db, `tasks/${taskId}`), null);
        fetchAllData();
        alert('Görev başarıyla silindi!');
      } catch (error) {
        console.error('Error deleting task:', error);
        alert('Görev silinirken bir hata oluştu.');
      }
    }
  };

  const resetForm = () => {
    setFormData({
      productId: '',
      fromType: 'production',
      fromId: '',
      toType: 'warehouse',
      toId: '',
      assignedTo: '',
      palletQuantity: 1,
      expirationDate: '',
      productionNumber: 1
    });
    setShowForm(false);
    setEditingTask(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'teslim_alma_dogrulama':
        return 'bg-yellow-100 text-yellow-800';
      case 'devam_ediyor':
        return 'bg-blue-100 text-blue-800';
      case 'tamamlandı':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'teslim_alma_dogrulama':
        return 'Teslim Alma Bekliyor';
      case 'devam_ediyor':
        return 'Devam Ediyor';
      case 'tamamlandı':
        return 'Tamamlandı';
      default:
        return 'Bilinmiyor';
    }
  };

  const getAvailableDestinations = () => {
    if (formData.toType === 'warehouse') return warehouses;
    if (formData.toType === 'truck') return trucks;
    return deliveryPoints;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Clipboard className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Görev Atama</h2>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {editingTask ? 'Düzenlemeyi İptal Et' : 'Yeni Görev Oluştur'}
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingTask ? 'Görev Düzenle' : 'Yeni Görev Oluştur'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ürün *
                </label>
                <select
                  value={formData.productId}
                  onChange={(e) => setFormData({...formData, productId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Ürün Seçin</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id}>
                      {product.name} (QR: {product.qrCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Şöför *
                </label>
                <select
                  value={formData.assignedTo}
                  onChange={(e) => setFormData({...formData, assignedTo: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Şöför Seçin</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Alma Noktası Tipi *
                </label>
                <select
                  value={formData.fromType}
                  onChange={(e) => setFormData({...formData, fromType: e.target.value as 'production' | 'warehouse', fromId: ''})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="production">Üretim Hattı</option>
                  <option value="warehouse">Depo</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Alma Noktası *
                </label>
                <select
                  value={formData.fromId}
                  onChange={(e) => setFormData({...formData, fromId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Nokta Seçin</option>
                  {(formData.fromType === 'production' ? productionLines : warehouses).map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name} (QR: {location.qrCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Etme Noktası Tipi *
                </label>
                <select
                  value={formData.toType}
                  onChange={(e) => setFormData({...formData, toType: e.target.value as 'warehouse' | 'truck' | 'deliveryPoint', toId: ''})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="warehouse">Depo</option>
                  <option value="truck">Tır</option>
                  <option value="deliveryPoint">Teslimat Noktası</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Etme Noktası *
                </label>
                <select
                  value={formData.toId}
                  onChange={(e) => setFormData({...formData, toId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Nokta Seçin</option>
                  {getAvailableDestinations().map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name} (QR: {location.qrCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Palet Sayısı *
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={formData.palletQuantity}
                  onChange={(e) => setFormData({...formData, palletQuantity: parseInt(e.target.value) || 1})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Üretim Numarası *
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.productionNumber}
                  onChange={(e) => setFormData({...formData, productionNumber: parseInt(e.target.value) || 1})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-6 py-2 rounded-md transition-colors"
              >
                {loading ? 'İşleniyor...' : (editingTask ? 'Görevi Güncelle' : 'Görev Oluştur')}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-md transition-colors"
              >
                İptal
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {tasks.map((task) => {
          const product = products.find(p => p.id === task.productId);
          const driver = users.find(u => u.id === task.assignedTo);

          return (
            <div key={task.id} className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{task.productName}</h3>
                  <p className="text-sm text-gray-500">
                    Üretim No: {task.productionNumber} | {task.palletQuantity} Palet
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${getStatusColor(task.status)}`}>
                    {getStatusText(task.status)}
                  </span>
                  <button
                    onClick={() => handleEdit(task)}
                    className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                    title="Görevi Düzenle"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                    title="Görevi Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-gray-600" />
                  <div>
                    <p className="text-xs text-gray-500">Şöför</p>
                    <p className="text-sm font-medium">{driver?.name || 'Bilinmiyor'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-600" />
                  <div>
                    <p className="text-xs text-gray-500">Teslim Alma</p>
                    <p className="text-sm font-medium">{task.from}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-600" />
                  <div>
                    <p className="text-xs text-gray-500">Teslim Etme</p>
                    <p className="text-sm font-medium">{task.to}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-600" />
                  <div>
                    <p className="text-xs text-gray-500">Son Kullanma</p>
                    <p className="text-sm font-medium">
                      {new Date(task.expirationDate).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleStatusChange(task.id, 'teslim_alma_dogrulama')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    task.status === 'teslim_alma_dogrulama'
                      ? 'bg-yellow-200 text-yellow-800'
                      : 'bg-gray-100 text-gray-600 hover:bg-yellow-100'
                  }`}
                >
                  Teslim Alma Bekliyor
                </button>
                <button
                  onClick={() => handleStatusChange(task.id, 'devam_ediyor')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    task.status === 'devam_ediyor'
                      ? 'bg-blue-200 text-blue-800'
                      : 'bg-gray-100 text-gray-600 hover:bg-blue-100'
                  }`}
                >
                  Devam Ediyor
                </button>
                <button
                  onClick={() => handleStatusChange(task.id, 'tamamlandı')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    task.status === 'tamamlandı'
                      ? 'bg-green-200 text-green-800'
                      : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                  }`}
                >
                  Tamamlandı
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {tasks.length === 0 && (
        <div className="text-center py-12">
          <Clipboard className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Henüz görev yok</h3>
          <p className="text-gray-500">İlk görevinizi oluşturmak için yukarıdaki butona tıklayın.</p>
        </div>
      )}
    </div>
  );
};

export default TaskManagement;