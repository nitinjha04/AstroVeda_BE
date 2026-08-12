const config = require('../../config');
const { shell } = require('./_layout');

const formatItems = (items = []) =>
  (items || [])
    .map(
      (it) =>
        `<li>${it.name || 'Item'} × ${it.quantity || 1} — ₹${Number(it.price || it.lineTotal || 0).toLocaleString('en-IN')}</li>`
    )
    .join('');

const orderPlacedCustomerTemplate = ({ order, customerName } = {}) => {
  const number = order?.orderNumber || order?._id || '—';
  return {
    subject: `${config.appName} – Order ${number} confirmed`,
    html: shell(
      'Order placed',
      `<p>Hi ${customerName || 'there'},</p>
       <p>Thanks for your order <strong>${number}</strong>.</p>
       <p><strong>Total:</strong> ₹${Number(order?.total || 0).toLocaleString('en-IN')}<br/>
       <strong>Payment:</strong> ${order?.paymentMethod || '—'} (${order?.paymentStatus || '—'})</p>
       <p><strong>Items</strong></p>
       <ul>${formatItems(order?.items)}</ul>
       <p>We will update you as fulfilment progresses.</p>`
    ),
  };
};

const orderPlacedAdminTemplate = ({ order, customer } = {}) => {
  const number = order?.orderNumber || order?._id || '—';
  return {
    subject: `[Admin] New order ${number}`,
    html: shell(
      'New store order',
      `<p>Order <strong>${number}</strong> was placed.</p>
       <p><strong>Customer:</strong> ${customer?.name || '—'} (${customer?.email || '—'})<br/>
       <strong>Total:</strong> ₹${Number(order?.total || 0).toLocaleString('en-IN')}<br/>
       <strong>Payment:</strong> ${order?.paymentMethod || '—'} / ${order?.paymentStatus || '—'}</p>
       <ul>${formatItems(order?.items)}</ul>`
    ),
  };
};

module.exports = { orderPlacedCustomerTemplate, orderPlacedAdminTemplate };
